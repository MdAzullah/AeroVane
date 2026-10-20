#!/usr/bin/env python3
"""Train a stronger local candidate without reading a final test split for decisions."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_development(path: Path, features: list[str]) -> dict[str, list[dict]]:
    result = {"train": [], "validation": []}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            if row.get("split") not in result or row.get("label") not in {"normal", "anomalous"}:
                continue
            result[row["split"]].append({
                "x": [row["features"].get(name) for name in features],
                "y": int(row["label"] == "anomalous"), "group": row["group_id"], "flight": row["flight_id"],
            })
    return result


def arrays(rows: list[dict]):
    x = np.asarray([[np.nan if value is None else value for value in row["x"]] for row in rows], dtype=float)
    y = np.asarray([row["y"] for row in rows], dtype=int)
    groups = np.asarray([row["group"] for row in rows])
    return x, y, groups


def metrics(y, probabilities, threshold: float) -> dict:
    predicted = np.asarray(probabilities) >= threshold
    tn, fp, fn, tp = confusion_matrix(y, predicted, labels=[0, 1]).ravel()
    precision = tp / max(1, tp + fp); recall = tp / max(1, tp + fn)
    return {"samples": int(len(y)), "tp": int(tp), "tn": int(tn), "fp": int(fp), "fn": int(fn),
            "precision": float(precision), "recall": float(recall), "f1": float(2 * precision * recall / max(1e-12, precision + recall)),
            "false_warning_rate": float(fp / max(1, fp + tn)), "missed_anomaly_rate": float(fn / max(1, fn + tp))}


def build_candidates(config: dict):
    seed = config["random_seed"]
    for kind, specs in config["candidates"].items():
        cls = ExtraTreesClassifier if kind == "extra_trees" else RandomForestClassifier
        for spec in specs:
            name = f"{kind}-n{spec['trees']}-d{spec['max_depth']}-leaf{spec['min_samples_leaf']}"
            estimator = cls(n_estimators=spec["trees"], max_depth=spec["max_depth"], min_samples_leaf=spec["min_samples_leaf"],
                            class_weight="balanced", random_state=seed, n_jobs=1)
            yield name, make_pipeline(SimpleImputer(strategy="median"), estimator)


def choose_threshold(y, probabilities, gate: dict) -> tuple[float, dict]:
    evaluated = [(value / 1000, metrics(y, probabilities, value / 1000)) for value in range(50, 951)]
    feasible = [item for item in evaluated if item[1]["recall"] >= gate["recall_min"] and item[1]["false_warning_rate"] <= gate["false_warning_rate_max"]]
    pool = feasible or evaluated
    return max(pool, key=lambda item: (item[1]["f1"], item[1]["recall"], -item[1]["false_warning_rate"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True); parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--windows", type=Path, required=True); parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists() or args.output.exists(): raise SystemExit("refusing to overwrite a candidate run")
    config = json.loads(args.config.read_text()); features = [item["name"] for item in json.loads(args.features.read_text())["features"]]
    rows = load_development(args.windows, features); train_x, train_y, groups = arrays(rows["train"]); validation_x, validation_y, _ = arrays(rows["validation"])
    if len(set(groups)) < config["group_folds"]: raise SystemExit("insufficient independent training groups")
    trials = []
    selected = None
    for name, model in build_candidates(config):
        fold_metrics = []
        for fit_index, score_index in GroupKFold(config["group_folds"]).split(train_x, train_y, groups):
            model.fit(train_x[fit_index], train_y[fit_index]); fold_metrics.append(metrics(train_y[score_index], model.predict_proba(train_x[score_index])[:, 1], 0.5))
        summary = {key: float(np.mean([fold[key] for fold in fold_metrics])) for key in ("f1", "recall", "false_warning_rate")}
        trial = {"candidate": name, "group_folds": config["group_folds"], "mean": summary, "folds": fold_metrics}; trials.append(trial)
        key = (summary["f1"], summary["recall"], -summary["false_warning_rate"], name)
        if selected is None or key > selected[0]: selected = (key, name, model)
    model = selected[2]; model.fit(train_x, train_y)
    raw_validation = model.predict_proba(validation_x)[:, 1]
    calibrator = IsotonicRegression(out_of_bounds="clip").fit(raw_validation, validation_y)
    calibrated = calibrator.predict(raw_validation)
    threshold, validation = choose_threshold(validation_y, calibrated, config["validation_gate"])
    accepted = validation["recall"] >= config["validation_gate"]["recall_min"] and validation["false_warning_rate"] <= config["validation_gate"]["false_warning_rate_max"]
    report = {"schema_version": "1.0.0", "experiment": config["experiment"], "config_sha256": digest(args.config),
              "windows_sha256": digest(args.windows), "features": features, "development_only": True,
              "test_rows_loaded": 0, "test_evaluations": 0, "trials": trials, "selected_candidate": selected[1],
              "threshold": threshold, "validation": validation, "validation_gate_passed": accepted,
              "release_authorized": False, "next_gate": "new untouched group-disjoint test cohort"}
    args.report.parent.mkdir(parents=True, exist_ok=True); args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    args.output.parent.mkdir(parents=True, exist_ok=True); joblib.dump({"model": model, "calibrator": calibrator, "threshold": threshold, "features": features, "report_sha256": digest(args.report)}, args.output)
    print(json.dumps({"selected": selected[1], "validation": validation, "validation_gate_passed": accepted, "release_authorized": False}, indent=2))
    return 0 if accepted else 2


if __name__ == "__main__": raise SystemExit(main())
