#!/usr/bin/env python3
"""Build deterministic, privacy-minimal feature windows from canonical JSONL."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping

WINDOW_MS = 5000.0
STRIDE_MS = 2500.0
BOUNDARY_PADDING_MS = 2000.0
FEATURES = (
    "battery_voltage_v_mean", "battery_voltage_v_min",
    "battery_current_a_mean", "battery_current_a_max",
    "accel_magnitude_mps2_mean", "accel_magnitude_mps2_max",
    "gyro_magnitude_radps_mean", "gyro_magnitude_radps_max",
    "velocity_magnitude_mps_mean", "velocity_magnitude_mps_max",
    "ekf_test_ratio_max", "attitude_abs_rad_max",
)


def _finite(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else None


def _magnitude(values: Mapping[str, Any], keys: tuple[str, str, str]) -> float | None:
    parts = [_finite(values.get(key)) for key in keys]
    return math.sqrt(sum(value * value for value in parts)) if all(value is not None for value in parts) else None


def observations(sample: Mapping[str, Any]) -> dict[str, float]:
    values = sample.get("values", {})
    result: dict[str, float] = {}
    scalar = {
        "battery_voltage_v": "battery.voltage_v",
        "battery_current_a": "battery.current_a",
    }
    for name, key in scalar.items():
        value = _finite(values.get(key))
        if value is not None:
            result[name] = value
    vectors = {
        "accel_magnitude_mps2": ("imu.xacc_mps2", "imu.yacc_mps2", "imu.zacc_mps2"),
        "gyro_magnitude_radps": ("imu.xgyro_radps", "imu.ygyro_radps", "imu.zgyro_radps"),
        "velocity_magnitude_mps": ("velocity.north_mps", "velocity.east_mps", "velocity.down_mps"),
    }
    for name, keys in vectors.items():
        value = _magnitude(values, keys)
        if value is not None:
            result[name] = value
    ratios = [_finite(values.get(key)) for key in (
        "ekf.velocity_test_ratio", "ekf.position_test_ratio", "ekf.height_test_ratio", "ekf.magnetometer_test_ratio"
    )]
    ratios = [value for value in ratios if value is not None]
    if ratios:
        result["ekf_test_ratio"] = max(ratios)
    attitude = [_finite(values.get(key)) for key in ("attitude.roll_rad", "attitude.pitch_rad", "attitude.yaw_rad")]
    attitude = [abs(value) for value in attitude if value is not None]
    if attitude:
        result["attitude_abs_rad"] = max(attitude)
    return result


def aggregate(samples: Iterable[Mapping[str, Any]]) -> tuple[dict[str, float | None], dict[str, int]]:
    buckets: dict[str, list[float]] = defaultdict(list)
    for sample in samples:
        for name, value in observations(sample).items():
            buckets[name].append(value)
    features: dict[str, float | None] = {}
    counts: dict[str, int] = {}
    for stem in ("battery_voltage_v", "battery_current_a", "accel_magnitude_mps2", "gyro_magnitude_radps", "velocity_magnitude_mps"):
        values = buckets[stem]
        for statistic in ("mean", "min" if stem == "battery_voltage_v" else "max"):
            key = f"{stem}_{statistic}"
            features[key] = (sum(values) / len(values) if statistic == "mean" else (min(values) if statistic == "min" else max(values))) if values else None
            counts[key] = len(values)
    for stem in ("ekf_test_ratio", "attitude_abs_rad"):
        key = f"{stem}_max"
        values = buckets[stem]
        features[key] = max(values) if values else None
        counts[key] = len(values)
    return features, counts


def window_label(label: Mapping[str, Any], start: float, end: float) -> str:
    overall = label.get("window_label")
    if overall in {"normal", "unknown"}:
        return str(overall)
    ranges = label.get("ranges_ms", [])
    if any(start < item["end"] and end > item["start"] for item in ranges):
        return "anomalous"
    if any(start < item["end"] + BOUNDARY_PADDING_MS and end > item["start"] - BOUNDARY_PADDING_MS for item in ranges):
        return "unknown"
    return "normal"


def build_flight(samples: list[Mapping[str, Any]], label: Mapping[str, Any], split: Mapping[str, Any]) -> list[dict[str, Any]]:
    if not samples:
        return []
    samples = sorted(samples, key=lambda item: item["timestampMs"])
    first = math.floor(float(samples[0]["timestampMs"]) / STRIDE_MS) * STRIDE_MS
    last = float(samples[-1]["timestampMs"])
    result: list[dict[str, Any]] = []
    index = 0
    start = first
    while start <= last:
        end = start + WINDOW_MS
        while index < len(samples) and float(samples[index]["timestampMs"]) < start:
            index += 1
        cursor = index
        window_samples = []
        while cursor < len(samples) and float(samples[cursor]["timestampMs"]) < end:
            window_samples.append(samples[cursor])
            cursor += 1
        features, counts = aggregate(window_samples)
        result.append({
            "flight_id": label["flight_id"], "sha256": label["sha256"],
            "group_id": split["group_id"], "split": split["split"],
            "start_ms": start, "end_ms": end,
            "label": window_label(label, start, end),
            "features": features, "observation_counts": counts,
        })
        start += STRIDE_MS
    return result


def run(input_dir: Path, labels: Mapping[str, Any], splits: Mapping[str, Any], output: Path, report_path: Path) -> dict[str, Any]:
    split_by_hash = {record["sha256"]: record for record in splits["records"]}
    all_windows: list[dict[str, Any]] = []
    per_flight = []
    presence = Counter()
    for label in labels["records"]:
        path = input_dir / f"{label['flight_id']}.jsonl"
        samples = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
        windows = build_flight(samples, label, split_by_hash[label["sha256"]])
        all_windows.extend(windows)
        counts = Counter(window["label"] for window in windows)
        for window in windows:
            presence.update(key for key, value in window["features"].items() if value is not None)
        per_flight.append({"flight_id": label["flight_id"], "windows": len(windows), "labels": dict(sorted(counts.items()))})
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for window in all_windows:
            handle.write(json.dumps(window, separators=(",", ":"), allow_nan=False) + "\n")
    total = len(all_windows)
    report = {
        "schema_version": "1.0.0", "window_ms": WINDOW_MS, "stride_ms": STRIDE_MS,
        "boundary_padding_ms": BOUNDARY_PADDING_MS, "window_count": total,
        "label_counts": dict(sorted(Counter(item["label"] for item in all_windows).items())),
        "split_counts": dict(sorted(Counter(item["split"] for item in all_windows).items())),
        "per_split_label_counts": {
            split: dict(sorted(Counter(item["label"] for item in all_windows if item["split"] == split).items()))
            for split in sorted({item["split"] for item in all_windows})
        },
        "feature_window_coverage": {key: round(presence[key] / total, 6) if total else 0 for key in FEATURES},
        "per_flight": per_flight,
        "privacy": {"location_features": False, "absolute_timestamps": False, "device_identifiers": False},
        "model_fitted": False,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("labels", type=Path)
    parser.add_argument("splits", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    splits = json.loads(args.splits.read_text(encoding="utf-8"))
    report = run(args.input_dir, labels, splits, args.output, args.report)
    print(f"Wrote {report['window_count']} excluded pilot windows; model_fitted={report['model_fitted']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
