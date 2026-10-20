#!/usr/bin/env python3
"""Combine validated Phase C cohorts without changing their flight lineage."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence


MANIFEST_KINDS = ("inventory", "labels", "groups", "splits", "quality")
FILE_SUFFIX = {"quality": "feature-quality"}


def _assert_same(name: str, values: Sequence[Any]) -> Any:
    if not values or any(value != values[0] for value in values[1:]):
        raise ValueError(f"cohorts disagree on {name}")
    return values[0]


def _unique(records: Sequence[Mapping[str, Any]], field: str) -> None:
    values = [record.get(field) for record in records]
    if any(not isinstance(value, str) or not value for value in values):
        raise ValueError(f"missing {field}")
    duplicates = sorted(value for value, count in Counter(values).items() if count > 1)
    if duplicates:
        raise ValueError(f"duplicate {field}: {', '.join(duplicates)}")


def combine(cohorts: Sequence[Mapping[str, Mapping[str, Any]]], created_at: str) -> dict[str, dict[str, Any]]:
    """Return cumulative manifests, rejecting changed or ambiguous lineage."""
    if not cohorts:
        raise ValueError("at least one cohort is required")
    for index, cohort in enumerate(cohorts, 1):
        missing = set(MANIFEST_KINDS) - set(cohort)
        if missing:
            raise ValueError(f"cohort {index} is missing: {', '.join(sorted(missing))}")

    source_id = _assert_same("source_id", [c["inventory"].get("source_id") for c in cohorts])
    source_version = _assert_same("source_version", [c["inventory"].get("source_version") for c in cohorts])
    identity = (source_id, source_version)
    for cohort in cohorts:
        for kind in ("labels", "groups", "splits"):
            document = cohort[kind]
            if (document.get("source_id"), document.get("source_version")) != identity:
                raise ValueError(f"{kind} source identity does not match inventory")
        if cohort["splits"].get("training_authorized") is not False:
            raise ValueError("every input cohort must explicitly prohibit training")
        if any(record.get("split") != "excluded" for record in cohort["splits"].get("records", [])):
            raise ValueError("every input record must remain excluded")
        if cohort["quality"].get("model_fitted") is not False:
            raise ValueError("input quality report indicates model fitting")

    inventory_files: list[dict[str, Any]] = []
    labels_records: list[dict[str, Any]] = []
    group_records: list[dict[str, Any]] = []
    split_records: list[dict[str, Any]] = []
    per_flight: list[dict[str, Any]] = []
    formats: Counter[str] = Counter()
    for index, cohort in enumerate(cohorts, 1):
        prefix = f"cohort-{index:03d}"
        for record in cohort["inventory"].get("files", []):
            item = dict(record)
            item["relative_path"] = f"{prefix}/{item['relative_path']}"
            if item.get("duplicate_of"):
                item["duplicate_of"] = f"{prefix}/{item['duplicate_of']}"
            inventory_files.append(item)
            formats[item["format"]] += 1
        labels_records.extend(dict(record) for record in cohort["labels"].get("records", []))
        group_records.extend(dict(record) for record in cohort["groups"].get("records", []))
        split_records.extend(dict(record) for record in cohort["splits"].get("records", []))
        per_flight.extend(dict(record) for record in cohort["quality"].get("per_flight", []))

    for records, field in ((inventory_files, "sha256"), (labels_records, "sha256"),
                           (group_records, "sha256"), (split_records, "sha256"),
                           (labels_records, "flight_id"), (group_records, "flight_id"),
                           (split_records, "flight_id"), (per_flight, "flight_id")):
        _unique(records, field)

    expected_hashes = {record["sha256"] for record in inventory_files}
    for name, records in (("labels", labels_records), ("groups", group_records), ("splits", split_records)):
        if {record["sha256"] for record in records} != expected_hashes:
            raise ValueError(f"{name} hashes do not exactly match cumulative inventory")
    expected_flights = {record["flight_id"] for record in labels_records}
    if {record["flight_id"] for record in per_flight} != expected_flights:
        raise ValueError("quality flights do not exactly match cumulative labels")

    feature_names = set(cohorts[0]["quality"].get("feature_window_coverage", {}))
    if any(set(c["quality"].get("feature_window_coverage", {})) != feature_names for c in cohorts[1:]):
        raise ValueError("cohorts disagree on feature set")
    total_windows = sum(c["quality"].get("window_count", 0) for c in cohorts)
    coverage = {}
    for feature in sorted(feature_names):
        available = sum(
            c["quality"]["feature_window_coverage"][feature] * c["quality"].get("window_count", 0)
            for c in cohorts
        )
        coverage[feature] = round(available / total_windows, 6) if total_windows else 0.0

    label_counts: Counter[str] = Counter()
    split_counts: Counter[str] = Counter()
    per_split: dict[str, Counter[str]] = {}
    for cohort in cohorts:
        label_counts.update(cohort["quality"].get("label_counts", {}))
        split_counts.update(cohort["quality"].get("split_counts", {}))
        for split, counts in cohort["quality"].get("per_split_label_counts", {}).items():
            per_split.setdefault(split, Counter()).update(counts)

    inventory = {
        "schema_version": "1.0.0", "created_at": created_at,
        "source_id": source_id, "source_version": source_version,
        "purpose": "phase_c_pilot_inventory", "files": inventory_files,
        "summary": {
            "file_count": len(inventory_files), "unique_file_count": len(inventory_files),
            "duplicate_count": 0, "total_bytes": sum(r["size_bytes"] for r in inventory_files),
            "unique_bytes": sum(r["size_bytes"] for r in inventory_files),
            "formats": dict(sorted(formats.items())),
        },
    }
    labels = {
        "schema_version": "1.0.0", "created_at": created_at,
        "source_id": source_id, "source_version": source_version,
        "inventory": "ml/manifests/uav-sead-774a336a-cumulative-inventory.json",
        "label_provenance": _assert_same("label_provenance", [c["labels"].get("label_provenance") for c in cohorts]),
        "records": labels_records,
    }
    groups = {
        "schema_version": "1.0.0", "created_at": created_at,
        "source_id": source_id, "source_version": source_version,
        "grouping_method": "preserved_mixed_cohort_grouping",
        "privacy_note": "Original conservative and keyed opaque group IDs are preserved; no private grouping inputs are included.",
        "records": group_records,
    }
    splits = {
        "schema_version": "1.0.0", "created_at": created_at, "frozen_at": created_at,
        "status": "frozen", "source_id": source_id, "source_version": source_version,
        "training_authorized": False, "records": split_records,
    }
    quality0 = cohorts[0]["quality"]
    for key in ("window_ms", "stride_ms", "boundary_padding_ms", "privacy"):
        _assert_same(key, [c["quality"].get(key) for c in cohorts])
    quality = {
        "schema_version": "1.0.0", "window_ms": quality0["window_ms"],
        "stride_ms": quality0["stride_ms"], "boundary_padding_ms": quality0["boundary_padding_ms"],
        "window_count": total_windows, "label_counts": dict(sorted(label_counts.items())),
        "split_counts": dict(sorted(split_counts.items())),
        "per_split_label_counts": {key: dict(sorted(value.items())) for key, value in sorted(per_split.items())},
        "feature_window_coverage": coverage, "per_flight": per_flight,
        "privacy": quality0["privacy"], "model_fitted": False,
    }
    return {"inventory": inventory, "labels": labels, "groups": groups, "splits": splits, "quality": quality}


def _load_cohort(prefix: Path) -> dict[str, Mapping[str, Any]]:
    return {
        kind: json.loads(Path(f"{prefix}-{FILE_SUFFIX.get(kind, kind)}.json").read_text(encoding="utf-8"))
        for kind in MANIFEST_KINDS
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_prefix", type=Path)
    parser.add_argument("cohort_prefixes", type=Path, nargs="+")
    parser.add_argument("--created-at", required=True, help="ISO-8601 timestamp used to freeze cumulative evidence")
    args = parser.parse_args()
    outputs = combine([_load_cohort(prefix) for prefix in args.cohort_prefixes], args.created_at)
    args.output_prefix.parent.mkdir(parents=True, exist_ok=True)
    for kind, document in outputs.items():
        Path(f"{args.output_prefix}-{FILE_SUFFIX.get(kind, kind)}.json").write_text(
            json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    print(f"Combined {len(args.cohort_prefixes)} cohorts: {len(outputs['labels']['records'])} flights, {outputs['quality']['window_count']} windows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
