#!/usr/bin/env python3
"""Train and export an advisory chipped-propeller detector from UAV-FD flights.

The split is fixed by physical motor index: motors 1-4 are development,
motor 5 is validation, and motor 6 is evaluated once as the untouched test
condition.  Normal flights with matching indices follow the same partition.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import joblib
import numpy as np
from scipy.io import loadmat
from sklearn.impute import SimpleImputer
from sklearn.metrics import confusion_matrix
from sklearn.pipeline import make_pipeline
from sklearn.tree import DecisionTreeClassifier

from model_contract import pipeline_to_artifact


EXPECTED_MD5 = {
    "NO_FAULT1.mat": "065e36e917d0e6188a3b766e17a720c7",
    "NO_FAULT2.mat": "828e8d88d73feea4bfd8268a51355803",
    "NO_FAULT3.mat": "5bb0fef01e1f8ca392de9aacb75fc325",
    "NO_FAULT4.mat": "65097e327521038f3d0c099c3afe8b69",
    "NO_FAULT5.mat": "22488aa7ed8fee78c0568149abc8efc0",
    "NO_FAULT6.mat": "068260a2e75c28fcdc6372057d232e88",
    "FAULT_M1_5.mat": "ad0fcc0d989e7fc728a0b2289c890a1e",
    "FAULT_M2_5.mat": "753b7e5214dd1f125bba9d563eca6831",
    "FAULT_M3_5.mat": "644663756532fa9771fdff1fa2f85f42",
    "FAULT_M4_5.mat": "54e8ab4e6b682a0156847adc7f09bbad",
    "FAULT_M5_5.mat": "8fd7fef15d431fc17b8fe29fec3d0cb5",
    "FAULT_M6_5.mat": "45a93738602695151627eb500ec662e2",
    "FAULT_M1_10.mat": "4e70d881431959585bb9737686f5f079",
    "FAULT_M2_10.mat": "fd3792291191532383461b1cfb4ff752",
    "FAULT_M3_10.mat": "ad20d6c8d668777e3efb7d7937c56b8a",
    "FAULT_M4_10.mat": "76cde4e92881f3ec0f02d2af40a516c9",
    "FAULT_M5_10.mat": "8f362ddf49bdaf2844e0b1e3292cfa68",
    "FAULT_M6_10.mat": "0791d6044f6803f948eca4c675d92f91",
}

FEATURES = [
    "accel_magnitude_mps2_mean", "accel_magnitude_mps2_std", "accel_magnitude_mps2_max",
    "gyro_magnitude_radps_mean", "gyro_magnitude_radps_std", "gyro_magnitude_radps_max",
    "vibration_magnitude_mps2_mean", "vibration_magnitude_mps2_std", "vibration_magnitude_mps2_max",
    "attitude_tracking_error_deg_mean", "attitude_tracking_error_deg_max",
    "motor_rpm_spread_pct_mean", "motor_rpm_spread_pct_max",
]


def md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def field(data: dict, name: str, label_name: str, field_name: str) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(data[name], dtype=float)
    labels = [str(item) for item in np.atleast_1d(data[label_name])]
    return values[:, labels.index("TimeUS")] / 1_000_000.0, values[:, labels.index(field_name)]


def vector(data: dict, name: str, label_name: str, fields: list[str]) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(data[name], dtype=float)
    labels = [str(item) for item in np.atleast_1d(data[label_name])]
    return values[:, labels.index("TimeUS")] / 1_000_000.0, values[:, [labels.index(item) for item in fields]]


def aggregate(times: np.ndarray, values: np.ndarray, start: float, end: float) -> tuple[float, float, float] | None:
    selected = np.asarray(values[(times >= start) & (times < end)], dtype=float)
    selected = selected[np.isfinite(selected)]
    if not len(selected):
        return None
    return float(np.mean(selected)), float(np.std(selected)), float(np.max(selected))


def flight_windows(path: Path) -> list[list[float | None]]:
    names = ["IMU_0", "IMU_label", "VIBE_0", "VIBE_label", "ATT", "ATT_label", "ESC_label"]
    names.extend(f"ESC_{index}" for index in range(6))
    data = loadmat(path, simplify_cells=True, variable_names=names)
    imu_t, acceleration = vector(data, "IMU_0", "IMU_label", ["AccX", "AccY", "AccZ"])
    _, angular_rate = vector(data, "IMU_0", "IMU_label", ["GyrX", "GyrY", "GyrZ"])
    vibe_t, vibration = vector(data, "VIBE_0", "VIBE_label", ["VibeX", "VibeY", "VibeZ"])
    att_t, attitude = vector(data, "ATT", "ATT_label", ["DesRoll", "Roll", "DesPitch", "Pitch"])
    acceleration = np.linalg.norm(acceleration, axis=1)
    angular_rate = np.linalg.norm(angular_rate, axis=1)
    vibration = np.linalg.norm(vibration, axis=1)
    attitude_error = np.hypot(attitude[:, 1] - attitude[:, 0], attitude[:, 3] - attitude[:, 2])
    esc = []
    for index in range(6):
        if f"ESC_{index}" in data:
            esc.append(field(data, f"ESC_{index}", "ESC_label", "RPM"))
    start, stop = max(imu_t.min(), vibe_t.min(), att_t.min()), min(imu_t.max(), vibe_t.max(), att_t.max())
    rows = []
    window_start = start
    while window_start + 5.0 <= stop:
        end = window_start + 5.0
        accel_stats = aggregate(imu_t, acceleration, window_start, end)
        gyro_stats = aggregate(imu_t, angular_rate, window_start, end)
        vibe_stats = aggregate(vibe_t, vibration, window_start, end)
        attitude_stats = aggregate(att_t, attitude_error, window_start, end)
        rpm_means = []
        for times, rpm in esc:
            values = rpm[(times >= window_start) & (times < end)]
            if len(values): rpm_means.append(float(np.mean(values)))
        rpm_spread = None
        if len(rpm_means) >= 4 and np.mean(rpm_means) > 1:
            rpm_spread = (max(rpm_means) - min(rpm_means)) / np.mean(rpm_means) * 100
        if accel_stats and gyro_stats and vibe_stats and attitude_stats:
            rows.append([*accel_stats, *gyro_stats, *vibe_stats, attitude_stats[0], attitude_stats[2], rpm_spread, rpm_spread])
        window_start += 2.5
    return rows


def partition(filename: str) -> str:
    number = int(re.search(r"(?:NO_FAULT|FAULT_M)(\d)", filename).group(1))
    return "train" if number <= 4 else "validation" if number == 5 else "test"


def scores(y_true: np.ndarray, probability: np.ndarray, threshold: float = 0.5,
           flights: list[str] | None = None, persistence: int = 1) -> dict:
    raw = probability >= threshold
    predicted = np.zeros(len(raw), dtype=bool)
    run = 0
    previous = None
    for index, value in enumerate(raw):
        flight = flights[index] if flights is not None else None
        if flight != previous:
            run = 0
            previous = flight
        run = run + 1 if value else 0
        predicted[index] = run >= persistence
    tn, fp, fn, tp = confusion_matrix(y_true, predicted, labels=[0, 1]).ravel()
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    return {"samples": int(len(y_true)), "tp": int(tp), "tn": int(tn), "fp": int(fp), "fn": int(fn),
            "precision": float(precision), "recall": float(recall), "f1": float(2 * precision * recall / max(1e-12, precision + recall)),
            "false_warning_rate": float(fp / max(1, fp + tn))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_dir", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("portable", type=Path)
    args = parser.parse_args()
    for output in (args.model, args.report, args.portable):
        if output.exists():
            raise SystemExit(f"refusing to overwrite {output}")
    rows = {name: {"x": [], "y": [], "flight": []} for name in ("train", "validation", "test")}
    inventory = []
    for filename, expected in EXPECTED_MD5.items():
        path = args.raw_dir / filename
        if not path.is_file() or md5(path) != expected:
            raise SystemExit(f"missing or checksum-mismatched input: {filename}")
        windows = flight_windows(path)
        split = partition(filename)
        label = int(filename.startswith("FAULT_"))
        rows[split]["x"].extend(windows); rows[split]["y"].extend([label] * len(windows)); rows[split]["flight"].extend([filename] * len(windows))
        inventory.append({"file": filename, "md5": expected, "windows": len(windows), "split": split, "label": label})
    arrays = {split: (np.asarray(value["x"], float), np.asarray(value["y"], int)) for split, value in rows.items()}
    candidates = []
    best = None
    for depth in (3, 4, 5, 6, 7):
        for leaf in (8, 16, 24, 32):
            model = make_pipeline(SimpleImputer(strategy="median"), DecisionTreeClassifier(max_depth=depth, min_samples_leaf=leaf, class_weight="balanced", random_state=7648996))
            model.fit(*arrays["train"])
            validation = scores(arrays["validation"][1], model.predict_proba(arrays["validation"][0])[:, 1],
                                flights=rows["validation"]["flight"], persistence=2)
            candidates.append({"max_depth": depth, "min_samples_leaf": leaf, "validation": validation})
            key = (validation["f1"], validation["recall"], -validation["false_warning_rate"], -depth, leaf)
            if best is None or key > best[0]: best = (key, model, depth, leaf)
    model = best[1]
    test_probability = model.predict_proba(arrays["test"][0])[:, 1]
    test_raw = scores(arrays["test"][1], test_probability)
    test = scores(arrays["test"][1], test_probability, flights=rows["test"]["flight"], persistence=2)
    accepted = bool(test["recall"] >= 0.8 and test["false_warning_rate"] <= 0.1 and test["f1"] >= 0.8)
    report = {"schema_version": "1.0.0", "experiment": "uav-fd-propulsion-1", "source": "10.5281/zenodo.7648996",
              "license": "CC-BY-4.0", "real_flight_data": True, "vehicle_family": "multicopter", "fault_family": "propulsion_actuator",
              "features": FEATURES, "window_seconds": 5.0, "stride_seconds": 2.5, "inventory": inventory, "candidates": candidates,
              "selected": {"max_depth": best[2], "min_samples_leaf": best[3]}, "test_raw_windows": test_raw,
              "test": test, "persistence_windows": 2, "test_evaluations": 1,
              "accepted": accepted, "release_authorized": False,
              "limitations": ["18 flights from one hexarotor", "chipped-propeller conditions only", "not validated for VTOL"]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    payload = {"model": model, "features": FEATURES, "persistence_windows": 2}
    args.model.parent.mkdir(parents=True, exist_ok=True); joblib.dump(payload, args.model)
    if accepted:
        artifact = pipeline_to_artifact(model, features=FEATURES, version="aerovane-uavfd-propulsion-1.0.0", persistence_windows=2,
                                        lineage={"experiment": report["experiment"], "report_sha256": hashlib.sha256(args.report.read_bytes()).hexdigest(),
                                                 "config_sha256": hashlib.sha256(json.dumps({"features": FEATURES, "selected": report["selected"]}, sort_keys=True).encode()).hexdigest()})
        args.portable.parent.mkdir(parents=True, exist_ok=True)
        args.portable.write_text(json.dumps(artifact, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"accepted": accepted, "selected": report["selected"], "test": test}, indent=2))
    return 0 if accepted else 2


if __name__ == "__main__":
    raise SystemExit(main())
