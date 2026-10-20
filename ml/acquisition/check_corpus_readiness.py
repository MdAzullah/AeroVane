#!/usr/bin/env python3
"""Assess a feature corpus against the controlled-experiment admission gate."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Mapping


def assess(policy: Mapping[str, Any], quality: Mapping[str, Any], groups: Mapping[str, Any], splits: Mapping[str, Any], registry: Mapping[str, Any]) -> dict[str, Any]:
    minimums = policy["minimums"]
    source = next((item for item in registry.get("sources", []) if item.get("id") == groups.get("source_id")), {})
    group_ids = {record["group_id"] for record in groups.get("records", [])}
    group_splits: dict[str, set[str]] = defaultdict(set)
    active_flight_ids: set[str] = set()
    for record in splits.get("records", []):
        group_splits[record["split"]].add(record["group_id"])
        if record["split"] in {"train", "validation", "test"}:
            active_flight_ids.add(record.get("flight_id"))

    normal_only = anomalous = eligible = 0
    for flight in quality.get("per_flight", []):
        if active_flight_ids and flight.get("flight_id") not in active_flight_ids:
            continue
        labels = flight.get("labels", {})
        if labels.get("anomalous", 0) > 0:
            anomalous += 1
            eligible += 1
        elif labels.get("normal", 0) > 0:
            normal_only += 1
            eligible += 1

    coverage = quality.get("feature_window_coverage", {})
    lowest_coverage = min(coverage.values(), default=0.0)
    split_labels = quality.get("per_split_label_counts", {})
    active_label_counts = Counter()
    for partition in ("train", "validation", "test"):
        active_label_counts.update(split_labels.get(partition, {}))
    actual = {
        "independent_groups": len(group_ids),
        "eligible_flights": eligible,
        "normal_only_flights": normal_only,
        "anomalous_flights": anomalous,
        "normal_windows": active_label_counts.get("normal", 0),
        "anomalous_windows": active_label_counts.get("anomalous", 0),
        "feature_window_coverage": lowest_coverage,
        "train_groups": len(group_splits["train"]),
        "validation_groups": len(group_splits["validation"]),
        "test_groups": len(group_splits["test"]),
    }
    checks = []
    for metric, required in minimums.items():
        value = actual[metric]
        checks.append({"check": metric, "actual": value, "required": required, "pass": value >= required, "shortfall": max(0, required - value)})
    checks.extend([
        {"check": "source_registry_approved", "actual": source.get("decision"), "required": "approved", "pass": source.get("decision") == "approved"},
        {"check": "training_explicitly_authorized", "actual": splits.get("training_authorized"), "required": True, "pass": splits.get("training_authorized") is True},
        {"check": "split_manifest_frozen", "actual": splits.get("status"), "required": "frozen", "pass": splits.get("status") == "frozen"},
        {"check": "preprocessing_did_not_fit_model", "actual": quality.get("model_fitted"), "required": False, "pass": quality.get("model_fitted") is False},
    ])
    required_labels = policy.get("required_labels_per_active_split", [])
    for partition in ("train", "validation", "test"):
        present = sorted(label for label in required_labels if split_labels.get(partition, {}).get(label, 0) > 0)
        checks.append({
            "check": f"{partition}_label_coverage",
            "actual": present,
            "required": required_labels,
            "pass": set(present) == set(required_labels),
        })
    return {
        "schema_version": "1.0.0",
        "gate": policy["gate"],
        "source_id": groups.get("source_id"),
        "source_version": groups.get("source_version"),
        "ready": all(item["pass"] for item in checks),
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("policy", type=Path)
    parser.add_argument("quality", type=Path)
    parser.add_argument("groups", type=Path)
    parser.add_argument("splits", type=Path)
    parser.add_argument("registry", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()
    paths = (args.policy, args.quality, args.groups, args.splits, args.registry)
    report = assess(*(json.loads(path.read_text(encoding="utf-8")) for path in paths))
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    print(f"Corpus ready={report['ready']}; passed {sum(item['pass'] for item in report['checks'])}/{len(report['checks'])} checks.")
    return 1 if args.require_ready and not report["ready"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
