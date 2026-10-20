#!/usr/bin/env python3
"""Run leakage-safe model selection and a single fresh-cohort evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from statistics import median

from train_real_anomaly_model import calibration, confusion, detection_delay, grouped_metrics, rule_probability


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_windows(paths: list[Path], features: list[str], forced_split: str | None = None) -> list[dict]:
    rows = []
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                if row["label"] not in {"normal", "anomalous"}:
                    continue
                row["x"] = [row["features"].get(name) for name in features]
                row["y"] = int(row["label"] == "anomalous")
                if forced_split:
                    row["split"] = forced_split
                rows.append(row)
    return rows


def verify_fresh_cohort(dev_rows: list[dict], test_rows: list[dict], expected_flights: int) -> dict:
    dev_hashes = {row["sha256"] for row in dev_rows}
    test_hashes = {row["sha256"] for row in test_rows}
    dev_groups = {row["group_id"] for row in dev_rows}
    test_groups = {row["group_id"] for row in test_rows}
    if dev_hashes & test_hashes:
        raise ValueError("fresh test hashes overlap development corpus")
    if dev_groups & test_groups:
        raise ValueError("fresh test groups overlap development corpus")
    if len(test_hashes) != expected_flights:
        raise ValueError(f"fresh cohort must contain exactly {expected_flights} eligible flights")
    if not {row["label"] for row in test_rows} == {"normal", "anomalous"}:
        raise ValueError("fresh cohort must contain both supervised labels")
    return {
        "flight_count": len(test_hashes),
        "group_count": len(test_groups),
        "development_hash_overlap": 0,
        "development_group_overlap": 0,
        "labels": dict(sorted((label, sum(row["label"] == label for row in test_rows)) for label in {"normal", "anomalous"})),
    }


def matrix(rows: list[dict]):
    import numpy as np
    return np.asarray([[float("nan") if value is None else value for value in row["x"]] for row in rows]), np.asarray([row["y"] for row in rows])


def candidates(config: dict):
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler
    from sklearn.tree import DecisionTreeClassifier

    seed = config["random_seed"]
    for c in config["candidates"]["logistic_regression"]["c"]:
        yield f"logistic-c{c}", make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=c, class_weight="balanced", max_iter=2000, random_state=seed))
    tree = config["candidates"]["decision_tree"]
    for depth in tree["max_depth"]:
        for leaf in tree["min_samples_leaf"]:
            yield f"tree-d{depth}-leaf{leaf}", make_pipeline(SimpleImputer(strategy="median"), DecisionTreeClassifier(max_depth=depth, min_samples_leaf=leaf, class_weight="balanced", random_state=seed))
    forest = config["candidates"]["random_forest"]
    for depth in forest["max_depth"]:
        for leaf in forest["min_samples_leaf"]:
            yield f"forest-d{depth}-leaf{leaf}", make_pipeline(SimpleImputer(strategy="median"), RandomForestClassifier(n_estimators=forest["trees"], max_depth=depth, min_samples_leaf=leaf, class_weight="balanced", random_state=seed, n_jobs=1))


def persisted(probabilities, rows, windows: int):
    result = []
    by_flight = defaultdict(list)
    for index, row in enumerate(rows):
        by_flight[row["flight_id"]].append((row["start_ms"], index))
    for items in by_flight.values():
        run = 0
        for _, index in sorted(items):
            run = run + 1 if probabilities[index] >= 0.5 else 0
            result.append((index, float(run >= windows)))
    return [value for _, value in sorted(result)]


def evaluate_candidate(model, train: list[dict], validation: list[dict], persistence: int) -> tuple[dict, list[float]]:
    train_x, train_y = matrix(train); validation_x, _ = matrix(validation)
    model.fit(train_x, train_y)
    raw = model.predict_proba(validation_x)[:, 1]
    probabilities = persisted(raw, validation, persistence)
    return confusion(validation, probabilities, 0.5), probabilities


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--development-windows", type=Path, required=True)
    parser.add_argument("--fresh-windows", type=Path, action="append", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--model-output", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists() or args.model_output.exists():
        raise SystemExit("refusing to repeat or overwrite Experiment 2")

    config = read_json(args.config)
    features = [item["name"] for item in read_json(args.features)["features"]]
    development = load_windows([args.development_windows], features)
    train = [row for row in development if row["split"] == "train"]
    validation = [row for row in development if row["split"] == "validation"]
    if not train or not validation:
        raise SystemExit("development corpus needs nonempty train and validation partitions")
    acquired_fresh = load_windows(args.fresh_windows, features, "fresh_test")
    excluded_groups = set(config.get("pre_evaluation_excluded_groups", []))
    actual_overlap = {row["group_id"] for row in acquired_fresh} & {row["group_id"] for row in development}
    if actual_overlap != excluded_groups:
        raise SystemExit("configured pre-evaluation group exclusions do not exactly match development overlap")
    excluded_rows = [row for row in acquired_fresh if row["group_id"] in excluded_groups]
    fresh = [row for row in acquired_fresh if row["group_id"] not in excluded_groups]
    if len({row["sha256"] for row in acquired_fresh}) != config["fresh_test_acquired_flights"]:
        raise SystemExit("acquired fresh flight count differs from frozen experiment config")
    cohort = verify_fresh_cohort(development, fresh, config["fresh_test_eligible_flights"])
    cohort["pre_evaluation_excluded_groups"] = sorted(excluded_groups)
    cohort["pre_evaluation_excluded_flights"] = len({row["sha256"] for row in excluded_rows})
    cohort["pre_evaluation_exclusion_reason"] = config["pre_evaluation_exclusion_reason"]

    trials = []
    best = None
    for name, model in candidates(config):
        for persistence in config["persistence_windows"]:
            metrics, _ = evaluate_candidate(model, train, validation, persistence)
            trial = {"candidate": name, "persistence_windows": persistence, "validation": metrics}
            trials.append(trial)
            key = (metrics["f1"], metrics["recall"], -metrics["false_warning_rate"], name, -persistence)
            if best is None or key > best[0]:
                best = (key, trial, model)

    selected = best[1]
    selected_model = best[2]
    dev_x, dev_y = matrix(train + validation)
    selected_model.fit(dev_x, dev_y)
    fresh_x, _ = matrix(fresh)
    probabilities = persisted(selected_model.predict_proba(fresh_x)[:, 1], fresh, selected["persistence_windows"])
    test = confusion(fresh, probabilities, 0.5)
    feature_index = {name: index for index, name in enumerate(features)}
    rules = confusion(fresh, [rule_probability(row, feature_index) for row in fresh], 0.5)
    acceptance = {
        "test_recall": test["recall"] >= config["acceptance"]["test_recall_min"],
        "test_false_warning_rate": test["false_warning_rate"] <= config["acceptance"]["test_false_warning_rate_max"],
        "test_f1_exceeds_rules": test["f1"] > rules["f1"],
    }
    report = {
        "schema_version": "1.0.0", "experiment": config["experiment"],
        "config_sha256": sha256(args.config), "features": features,
        "development_partitions": ["train", "validation"], "experiment_1_test_used_for_development": False,
        "fresh_cohort": cohort, "trials": trials, "selected": selected,
        "test_evaluations": 1, "fresh_test": test, "rules_fresh_test": rules,
        "fresh_test_calibration": calibration(fresh, probabilities),
        "fresh_test_per_flight": grouped_metrics(fresh, probabilities, 0.5, "flight_id"),
        "fresh_test_per_group": grouped_metrics(fresh, probabilities, 0.5, "group_id"),
        "fresh_test_detection_delay": detection_delay(fresh, probabilities, 0.5),
        "acceptance": acceptance, "accepted": all(acceptance.values()),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if report["accepted"]:
        import joblib
        args.model_output.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": selected_model, "features": features, "persistence_windows": selected["persistence_windows"], "advisory_only": True}, args.model_output)
    print(json.dumps({"accepted": report["accepted"], "selected": selected, "fresh_test": test, "rules": rules}, indent=2))
    return 0 if report["accepted"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
