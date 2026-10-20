#!/usr/bin/env python3
"""Freeze a reviewed cumulative corpus and deterministic leakage-safe splits."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def stable_order(group_id: str) -> str:
    return hashlib.sha256(("aerovane-reviewed-v1:" + group_id).encode()).hexdigest()


def allocate(group_ids: list[str]) -> dict[str, str]:
    ordered = sorted(group_ids, key=stable_order)
    count = len(ordered)
    validation = max(1, round(count * 0.2))
    test = max(1, round(count * 0.2))
    train = count - validation - test
    if train < 1:
        raise ValueError("label stratum needs at least three independent groups")
    result = {}
    for index, group_id in enumerate(ordered):
        result[group_id] = "train" if index < train else "validation" if index < train + validation else "test"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("labels", type=Path)
    parser.add_argument("groups", type=Path)
    parser.add_argument("output_prefix", type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--source-version", required=True)
    parser.add_argument("--created-at", required=True)
    args = parser.parse_args()
    inventory, labels, groups = [json.loads(path.read_text()) for path in (args.inventory, args.labels, args.groups)]
    labels_by_flight = {record["flight_id"]: record for record in labels["records"]}
    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in groups["records"]:
        grouped[record["group_id"]].append(record)

    strata = {"normal": [], "anomalous": []}
    excluded = set()
    for group_id, records in grouped.items():
        group_labels = [labels_by_flight[record["flight_id"]] for record in records]
        if any(label["training_eligible"] is not True or label["window_label"] == "unknown" for label in group_labels):
            excluded.add(group_id)
        elif any(label["window_label"] == "anomalous" for label in group_labels):
            strata["anomalous"].append(group_id)
        else:
            strata["normal"].append(group_id)
    assignments = {}
    for group_ids in strata.values():
        assignments.update(allocate(group_ids))

    identity = {"source_id": args.source_id, "source_version": args.source_version}
    reviewed_inventory = inventory | identity | {"created_at": args.created_at}
    reviewed_labels = labels | identity | {
        "created_at": args.created_at,
        "inventory": f"{args.output_prefix}-inventory.json",
    }
    reviewed_groups = groups | identity | {"created_at": args.created_at}
    split_records = []
    for record in groups["records"]:
        partition = assignments.get(record["group_id"], "excluded")
        split_records.append({
            "flight_id": record["flight_id"], "sha256": record["sha256"], "group_id": record["group_id"],
            "split": partition,
            "reason": "Group contains an unknown or ineligible flight." if partition == "excluded" else None,
        })
    splits = {
        "schema_version": "1.0.0", "created_at": args.created_at, "frozen_at": args.created_at,
        "status": "frozen", **identity, "training_authorized": False, "records": split_records,
    }
    outputs = {"inventory": reviewed_inventory, "labels": reviewed_labels, "groups": reviewed_groups, "splits": splits}
    args.output_prefix.parent.mkdir(parents=True, exist_ok=True)
    for kind, document in outputs.items():
        Path(f"{args.output_prefix}-{kind}.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    counts = {name: len(set(r["group_id"] for r in split_records if r["split"] == name)) for name in ("train", "validation", "test", "excluded")}
    print(f"Frozen reviewed corpus: {counts}; training_authorized=False")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
