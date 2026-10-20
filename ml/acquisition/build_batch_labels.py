#!/usr/bin/env python3
"""Build privacy-minimal labels and excluded split manifests for an acquired batch."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping

ANOMALY_CLASSES = {"Altitude", "External Position", "Global Position", "Mechanical"}


def source_key(locator: str) -> str:
    if not locator.startswith("ulg_files/") or not locator.endswith(".ulg"):
        raise ValueError("source locator must be a ULog under ulg_files")
    return locator[len("ulg_files/"):-len(".ulg")]


def canonical_bounds(path: Path) -> tuple[float, float]:
    first = last = None
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            timestamp = float(json.loads(line)["timestampMs"])
            first = timestamp if first is None else min(first, timestamp)
            last = timestamp if last is None else max(last, timestamp)
    if first is None or last is None:
        raise ValueError(f"canonical file is empty: {path}")
    return first, last


def convert_annotation(document: Mapping[str, Any], first_ms: float, last_ms: float) -> tuple[str, list[str], list[dict[str, Any]]]:
    annotations = document.get("annotations", [])
    classes = sorted({item.get("class") for item in annotations if item.get("class")})
    ranges = []
    for annotation in annotations:
        source_class = annotation.get("class")
        for source_signal, intervals in annotation.get("ranges", []):
            for start_us, end_us in intervals:
                start, end = float(start_us) / 1000.0, float(end_us) / 1000.0
                if not 0 <= start < end:
                    raise ValueError("annotation range must satisfy 0 <= start < end")
                if start < first_ms or end > last_ms:
                    raise ValueError(f"annotation range [{start}, {end}] is outside parsed flight [{first_ms}, {last_ms}]")
                ranges.append({"start": start, "end": end, "source_class": source_class, "source_signal": source_signal})
    has_anomaly = any(name in ANOMALY_CLASSES for name in classes)
    if has_anomaly and ranges:
        label = "anomalous"
    elif classes == ["Normal"] and not ranges:
        label = "normal"
    else:
        label = "unknown"
    return label, classes, sorted(ranges, key=lambda item: (item["start"], item["end"], item["source_class"], item["source_signal"]))


def build(
    mapping: Mapping[str, Any], private_map: Mapping[str, Any], proposal: Mapping[str, Any],
    inventory: Mapping[str, Any], canonical_dir: Path, first_flight_number: int,
    inventory_reference: str = "ml/manifests/uav-sead-774a336a-batch-001-inventory.json",
    created_at: str = "2026-09-26T00:20:00Z",
) -> tuple[dict, dict, dict]:
    inventory_by_candidate = {Path(item["relative_path"]).stem: item for item in inventory["files"]}
    proposal_by_candidate = {item["candidate_id"]: item for item in proposal["records"]}
    label_records, group_records, split_records = [], [], []
    for offset, candidate_id in enumerate(sorted(proposal_by_candidate)):
        flight_id = f"flight-{first_flight_number + offset:03d}"
        item = inventory_by_candidate[candidate_id]
        canonical_path = canonical_dir / f"{candidate_id}.jsonl"
        if not canonical_path.exists():
            canonical_path = canonical_dir / f"{flight_id}.jsonl"
        first_ms, last_ms = canonical_bounds(canonical_path)
        annotation = mapping[source_key(private_map["mapping"][candidate_id])]
        label_error = None
        try:
            label, classes, ranges = convert_annotation(annotation, first_ms, last_ms)
        except ValueError as error:
            label = "unknown"
            classes = sorted({entry.get("class") for entry in annotation.get("annotations", []) if entry.get("class")})
            ranges = []
            label_error = f"Source annotation rejected during range validation: {error}"
        eligible = label != "unknown"
        label_records.append({
            "flight_id": flight_id, "sha256": item["sha256"], "window_label": label,
            "source_classes": classes, "ranges_ms": ranges, "fault_family": None,
            "training_eligible": eligible,
            "exclusion_reason": None if eligible else (label_error or "Source annotation is not usable as a ranged anomaly or confirmed normal flight."),
        })
        group_id = proposal_by_candidate[candidate_id]["group_id"]
        group_records.append({"flight_id": flight_id, "sha256": item["sha256"], "group_id": group_id})
        split_records.append({
            "flight_id": flight_id, "sha256": item["sha256"], "group_id": group_id,
            "split": "excluded", "reason": "Source remains quarantined; batch validation does not authorize training or evaluation.",
        })
    identity = {"schema_version": "1.0.0", "source_id": inventory["source_id"], "source_version": inventory["source_version"]}
    labels = identity | {"created_at": created_at, "inventory": inventory_reference, "label_provenance": "expert_review", "records": label_records}
    groups = identity | {"created_at": created_at, "grouping_method": "keyed_pseudonymous_collection_group", "privacy_note": "Collection paths are represented only by keyed opaque group IDs.", "records": group_records}
    splits = identity | {"created_at": created_at, "frozen_at": created_at, "status": "frozen", "training_authorized": False, "records": split_records}
    return labels, groups, splits


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mapping", type=Path)
    parser.add_argument("private_map", type=Path)
    parser.add_argument("proposal", type=Path)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("canonical_dir", type=Path)
    parser.add_argument("labels_output", type=Path)
    parser.add_argument("groups_output", type=Path)
    parser.add_argument("splits_output", type=Path)
    parser.add_argument("--first-flight-number", type=int, required=True)
    parser.add_argument("--created-at", required=True)
    parser.add_argument("--inventory-reference", required=True)
    args = parser.parse_args()
    inputs = [json.loads(path.read_text(encoding="utf-8")) for path in (args.mapping, args.private_map, args.proposal, args.inventory)]
    outputs = build(
        *inputs, args.canonical_dir, args.first_flight_number,
        inventory_reference=args.inventory_reference, created_at=args.created_at,
    )
    for path, document in zip((args.labels_output, args.groups_output, args.splits_output), outputs):
        path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    counts = {label: sum(record["window_label"] == label for record in outputs[0]["records"]) for label in ("normal", "anomalous", "unknown")}
    print(f"Built {len(outputs[0]['records'])} neutral labels: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
