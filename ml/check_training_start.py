#!/usr/bin/env python3
"""Fail-closed preflight for starting a controlled AeroVane training run."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path


EXPECTED_PACKAGES = {"numpy": "1.26.4", "scipy": "1.11.4", "scikit-learn": "1.7.2", "joblib": "1.6.0"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--readiness", type=Path, required=True)
    parser.add_argument("--authorization", type=Path, required=True)
    parser.add_argument("--windows", type=Path, required=True)
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--groups", type=Path, required=True)
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--feature-quality", type=Path, required=True)
    args = parser.parse_args()
    readiness = json.loads(args.readiness.read_text(encoding="utf-8"))
    authorization = json.loads(args.authorization.read_text(encoding="utf-8"))
    failures = []
    if readiness.get("ready") is not True or not readiness.get("checks") or not all(item.get("pass") is True for item in readiness["checks"]):
        failures.append("strict corpus readiness is not fully satisfied")
    if authorization.get("status") != "authorized":
        failures.append("training authorization is false")
    if not args.windows.is_file() or not args.features.is_file():
        failures.append("frozen windows or feature contract is missing")
    versions = {}
    for package, expected in EXPECTED_PACKAGES.items():
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
        if versions[package] != expected:
            failures.append(f"{package} must be {expected}, found {versions[package]}")
    bindings = authorization.get("bindings", {})
    bound_files = {
        "inventory_sha256": args.inventory, "labels_sha256": args.labels, "groups_sha256": args.groups,
        "authorized_splits_sha256": args.splits, "feature_quality_sha256": args.feature_quality,
    }
    for binding, path in bound_files.items():
        if not path.is_file() or bindings.get(binding) != sha256(path):
            failures.append(f"authorization binding mismatch: {binding}")
    result = {
        "ready_to_start_training": not failures,
        "failures": failures,
        "environment": versions,
        "inputs": {"windows_sha256": sha256(args.windows) if args.windows.is_file() else None, "features_sha256": sha256(args.features) if args.features.is_file() else None},
        "guardrails": {"advisory_only": True, "test_data_forbidden_during_development": True, "unknown_labels_excluded": True},
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
