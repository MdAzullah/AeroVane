#!/usr/bin/env python3
"""Assess an experiment report against the prospective advisory release gate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping


def _check(name: str, actual: Any, required: Any, passed: bool) -> dict[str, Any]:
    return {"check": name, "actual": actual, "required": required, "pass": passed}


def assess(policy: Mapping[str, Any], report: Mapping[str, Any], *, external_dataset: bool = False) -> dict[str, Any]:
    cohort = report["fresh_cohort"]
    metrics = report["fresh_test"]
    calibration = report["fresh_test_calibration"]
    per_flight = report["fresh_test_per_flight"]
    items = list(per_flight["items"].values())
    anomalous = [item for item in items if item["tp"] + item["fn"] > 0]
    normal = [item for item in items if item["tp"] + item["fn"] == 0]
    warned_normal = [item for item in normal if item["fp"] > 0]
    clean_warning_rate = len(warned_normal) / len(normal) if normal else 1.0

    checks: list[dict[str, Any]] = []
    actual_minimums = {
        "independent_test_groups": cohort["group_count"],
        "normal_test_flights": len(normal),
        "anomalous_test_flights": len(anomalous),
        "recall": metrics["recall"],
        "macro_f1": per_flight["macro_f1"],
    }
    for name, required in policy["minimums"].items():
        actual = actual_minimums[name]
        checks.append(_check(name, actual, required, actual >= required))

    actual_maximums = {
        "window_false_warning_rate": metrics["false_warning_rate"],
        "clean_flights_with_warning_rate": clean_warning_rate,
        "brier_score": calibration["brier_score"],
        "expected_calibration_error": calibration["expected_calibration_error"],
    }
    for name, required in policy["maximums"].items():
        actual = actual_maximums[name]
        checks.append(_check(name, actual, required, actual <= required))

    requirements = policy["requirements"]
    checks.extend([
        _check("group_disjoint", cohort["development_group_overlap"] == 0, True, cohort["development_group_overlap"] == 0),
        _check("hash_disjoint", cohort["development_hash_overlap"] == 0, True, cohort["development_hash_overlap"] == 0),
        _check("external_dataset_or_collection", external_dataset, True, external_dataset),
        _check("test_evaluations", report["test_evaluations"], requirements["test_evaluations"], report["test_evaluations"] == requirements["test_evaluations"]),
        _check("advisory_only", True, requirements["advisory_only"], requirements["advisory_only"] is True),
        _check("component_diagnosis_allowed", False, requirements["component_diagnosis_allowed"], requirements["component_diagnosis_allowed"] is False),
    ])
    return {
        "schema_version": "1.0.0",
        "gate": policy["gate"],
        "experiment": report["experiment"],
        "release_ready": all(item["pass"] for item in checks),
        "prospective_only": True,
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("policy", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("--external-dataset", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()
    result = assess(
        json.loads(args.policy.read_text(encoding="utf-8")),
        json.loads(args.report.read_text(encoding="utf-8")),
        external_dataset=args.external_dataset,
    )
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    passed = sum(item["pass"] for item in result["checks"])
    print(f"Release ready={result['release_ready']}; passed {passed}/{len(result['checks'])} checks.")
    return 1 if args.require_ready and not result["release_ready"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
