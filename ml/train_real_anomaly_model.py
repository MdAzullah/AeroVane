#!/usr/bin/env python3
"""Train the first authorized real-data binary anomaly model without leakage."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import median


def sigmoid(value: float) -> float:
    value = max(-30.0, min(30.0, value))
    return 1.0 / (1.0 + math.exp(-value))


def load_rows(path: Path, features: list[str]) -> dict[str, list[dict]]:
    result = {"train": [], "validation": [], "test": []}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            if row["split"] not in result or row["label"] not in {"normal", "anomalous"}:
                continue
            row["x"] = [row["features"].get(name) for name in features]
            row["y"] = int(row["label"] == "anomalous")
            result[row["split"]].append(row)
    return result


def fit_preprocessing(rows: list[dict], feature_count: int) -> tuple[list[float], list[float], list[float]]:
    medians, means, scales = [], [], []
    for index in range(feature_count):
        values = [row["x"][index] for row in rows if row["x"][index] is not None]
        if not values:
            raise ValueError(f"training feature {index} has no observed values")
        fill = median(values)
        filled = [row["x"][index] if row["x"][index] is not None else fill for row in rows]
        mean = sum(filled) / len(filled)
        variance = sum((value - mean) ** 2 for value in filled) / len(filled)
        medians.append(fill); means.append(mean); scales.append(max(math.sqrt(variance), 1e-9))
    return medians, means, scales


def transform(row: dict, medians: list[float], means: list[float], scales: list[float]) -> list[float]:
    return [((value if value is not None else medians[i]) - means[i]) / scales[i] for i, value in enumerate(row["x"])]


def fit(rows: list[dict], medians: list[float], means: list[float], scales: list[float]) -> tuple[list[float], float]:
    weights, bias = [0.0] * len(medians), 0.0
    positives = sum(row["y"] for row in rows); negatives = len(rows) - positives
    class_weight = {0: len(rows) / (2 * negatives), 1: len(rows) / (2 * positives)}
    for epoch in range(800):
        gradient = [0.0] * len(weights); bias_gradient = 0.0
        for row in rows:
            x = transform(row, medians, means, scales)
            error = (sigmoid(bias + sum(w * v for w, v in zip(weights, x))) - row["y"]) * class_weight[row["y"]]
            for index, value in enumerate(x): gradient[index] += error * value
            bias_gradient += error
        rate = 0.12 / (1.0 + epoch / 250.0) / len(rows)
        weights = [weight - rate * (grad + 0.02 * weight) for weight, grad in zip(weights, gradient)]
        bias -= rate * bias_gradient
    return weights, bias


def score(rows: list[dict], weights: list[float], bias: float, prep: tuple[list[float], list[float], list[float]]) -> list[float]:
    return [sigmoid(bias + sum(w * v for w, v in zip(weights, transform(row, *prep)))) for row in rows]


def confusion(rows: list[dict], probabilities: list[float], threshold: float) -> dict:
    tp = tn = fp = fn = 0
    for row, probability in zip(rows, probabilities):
        predicted = probability >= threshold
        tp += int(predicted and row["y"] == 1); tn += int(not predicted and row["y"] == 0)
        fp += int(predicted and row["y"] == 0); fn += int(not predicted and row["y"] == 1)
    precision = tp / max(1, tp + fp); recall = tp / max(1, tp + fn)
    return {
        "samples": len(rows), "tp": tp, "tn": tn, "fp": fp, "fn": fn,
        "accuracy": (tp + tn) / max(1, len(rows)), "precision": precision, "recall": recall,
        "false_warning_rate": fp / max(1, fp + tn), "missed_anomaly_rate": fn / max(1, fn + tp),
        "f1": 2 * precision * recall / max(1e-12, precision + recall),
    }


def calibration(rows: list[dict], probabilities: list[float]) -> dict:
    brier = sum((p - row["y"]) ** 2 for row, p in zip(rows, probabilities)) / len(rows)
    bins = []
    for lower in [i / 10 for i in range(10)]:
        indexes = [i for i, p in enumerate(probabilities) if lower <= p < lower + 0.1 or (lower == 0.9 and p == 1)]
        if indexes:
            bins.append({"lower": lower, "count": len(indexes), "mean_probability": sum(probabilities[i] for i in indexes) / len(indexes), "observed_rate": sum(rows[i]["y"] for i in indexes) / len(indexes)})
    ece = sum(item["count"] / len(rows) * abs(item["mean_probability"] - item["observed_rate"]) for item in bins)
    return {"brier_score": brier, "expected_calibration_error": ece, "bins": bins}


def grouped_metrics(rows: list[dict], probabilities: list[float], threshold: float, field: str) -> dict:
    grouped = defaultdict(lambda: [[], []])
    for row, probability in zip(rows, probabilities):
        grouped[row[field]][0].append(row); grouped[row[field]][1].append(probability)
    values = {key: confusion(*items, threshold) for key, items in sorted(grouped.items())}
    return {"count": len(values), "macro_f1": sum(v["f1"] for v in values.values()) / len(values), "items": values}


def detection_delay(rows: list[dict], probabilities: list[float], threshold: float) -> dict:
    by_flight = defaultdict(list)
    for row, probability in zip(rows, probabilities): by_flight[row["flight_id"]].append((row, probability))
    delays, missed = [], 0
    for items in by_flight.values():
        anomalous = [row["start_ms"] for row, _ in items if row["y"] == 1]
        if not anomalous: continue
        start = min(anomalous)
        detections = [row["start_ms"] for row, p in items if row["start_ms"] >= start and p >= threshold]
        if detections: delays.append(max(0.0, min(detections) - start))
        else: missed += 1
    return {"detected_flights": len(delays), "missed_flights": missed, "median_delay_ms": median(delays) if delays else None, "max_delay_ms": max(delays) if delays else None}


def rule_probability(row: dict, feature_index: dict[str, int]) -> float:
    def value(name): return row["x"][feature_index[name]]
    hits = [
        value("battery_voltage_v_min") is not None and value("battery_voltage_v_min") < 10.5,
        value("accel_magnitude_mps2_max") is not None and value("accel_magnitude_mps2_max") >= 30.0,
        value("gyro_magnitude_radps_max") is not None and value("gyro_magnitude_radps_max") >= 3.0,
        value("velocity_magnitude_mps_max") is not None and value("velocity_magnitude_mps_max") >= 25.0,
        value("ekf_test_ratio_max") is not None and value("ekf_test_ratio_max") >= 1.0,
    ]
    return float(any(hits))


def choose_threshold(rows: list[dict], probabilities: list[float]) -> tuple[float, dict]:
    candidates = sorted({round(i / 1000, 3) for i in range(50, 951)})
    evaluated = [(threshold, confusion(rows, probabilities, threshold)) for threshold in candidates]
    feasible = [item for item in evaluated if item[1]["false_warning_rate"] <= 0.10 and item[1]["recall"] >= 0.60]
    pool = feasible or evaluated
    return max(pool, key=lambda item: (item[1]["f1"], -item[1]["false_warning_rate"], item[1]["recall"], item[0]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("windows", type=Path); parser.add_argument("features", type=Path)
    parser.add_argument("readiness", type=Path); parser.add_argument("report", type=Path)
    parser.add_argument("--model-output", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists():
        raise SystemExit("experiment report already exists; frozen test evaluation cannot be repeated or overwritten")
    if args.model_output.exists():
        raise SystemExit("model output already exists; refusing to overwrite a released artifact")
    readiness = json.loads(args.readiness.read_text())
    if readiness.get("ready") is not True: raise SystemExit("strict readiness report is not ready")
    feature_names = [item["name"] for item in json.loads(args.features.read_text())["features"]]
    rows = load_rows(args.windows, feature_names)
    if any(not rows[name] for name in rows): raise SystemExit("every active split needs supervised rows")
    prep = fit_preprocessing(rows["train"], len(feature_names))
    weights, bias = fit(rows["train"], *prep)
    probabilities = {name: score(partition, weights, bias, prep) for name, partition in rows.items()}
    threshold, validation_metrics = choose_threshold(rows["validation"], probabilities["validation"])
    test_metrics = confusion(rows["test"], probabilities["test"], threshold)
    rule_probs = [rule_probability(row, {name: i for i, name in enumerate(feature_names)}) for row in rows["test"]]
    rule_test = confusion(rows["test"], rule_probs, 0.5)
    acceptance = {
        "validation_false_warning_rate_lte_0_10": validation_metrics["false_warning_rate"] <= 0.10,
        "validation_recall_gte_0_60": validation_metrics["recall"] >= 0.60,
        "test_false_warning_rate_lte_0_15": test_metrics["false_warning_rate"] <= 0.15,
        "test_recall_gte_0_50": test_metrics["recall"] >= 0.50,
        "test_f1_gte_rules": test_metrics["f1"] >= rule_test["f1"],
    }
    report = {
        "schema_version": "1.0.0", "experiment": "uav-sead-reviewed-v1-logistic-baseline",
        "features": feature_names, "split_row_counts": {name: len(value) for name, value in rows.items()},
        "preprocessing_fit_split": "train", "model_fit_split": "train", "threshold_selection_split": "validation",
        "test_evaluations": 1, "threshold": threshold,
        "validation": validation_metrics, "test": test_metrics, "rules_test": rule_test,
        "test_calibration": calibration(rows["test"], probabilities["test"]),
        "test_per_flight": grouped_metrics(rows["test"], probabilities["test"], threshold, "flight_id"),
        "test_per_group": grouped_metrics(rows["test"], probabilities["test"], threshold, "group_id"),
        "test_detection_delay": detection_delay(rows["test"], probabilities["test"], threshold),
        "acceptance": acceptance, "accepted": all(acceptance.values()),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    if report["accepted"]:
        artifact = {"version": "skyforge-real-anomaly-1.0.0", "advisory_only": True, "features": feature_names,
                    "imputation_medians": prep[0], "means": prep[1], "scales": prep[2],
                    "weights": weights, "bias": bias, "threshold": threshold}
        args.model_output.parent.mkdir(parents=True, exist_ok=True)
        args.model_output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"accepted": report["accepted"], "threshold": threshold, "validation": validation_metrics, "test": test_metrics, "rules_test": rule_test}, indent=2))
    return 0 if report["accepted"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
