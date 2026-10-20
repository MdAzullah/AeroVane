#!/usr/bin/env python3
"""Validate privacy-safe flight groups and leakage-safe dataset splits."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping

ACTIVE_SPLITS = {"train", "validation", "test"}
ALL_SPLITS = ACTIVE_SPLITS | {"excluded"}


def _index(records: list[Mapping[str, Any]], key: str, name: str, errors: list[str]) -> dict[str, Mapping[str, Any]]:
    result: dict[str, Mapping[str, Any]] = {}
    for record in records:
        value = record.get(key)
        if not isinstance(value, str) or not value:
            errors.append(f"{name}: missing {key}")
        elif value in result:
            errors.append(f"{name}: duplicate {key}: {value}")
        else:
            result[value] = record
    return result


def validate(
    groups: Mapping[str, Any],
    splits: Mapping[str, Any],
    inventory: Mapping[str, Any],
    labels: Mapping[str, Any],
    registry: Mapping[str, Any],
) -> list[str]:
    errors: list[str] = []
    for name, document in (("groups", groups), ("splits", splits)):
        if document.get("schema_version") != "1.0.0":
            errors.append(f"{name}: schema_version must be 1.0.0")

    identity = (inventory.get("source_id"), inventory.get("source_version"))
    for name, document in (("groups", groups), ("splits", splits), ("labels", labels)):
        if (document.get("source_id"), document.get("source_version")) != identity:
            errors.append(f"{name}: source identity does not match inventory")

    inventory_by_hash = _index(inventory.get("files", []), "sha256", "inventory", errors)
    labels_by_hash = _index(labels.get("records", []), "sha256", "labels", errors)
    groups_by_hash = _index(groups.get("records", []), "sha256", "groups", errors)
    splits_by_hash = _index(splits.get("records", []), "sha256", "splits", errors)
    expected = set(inventory_by_hash)
    for name, indexed in (("labels", labels_by_hash), ("groups", groups_by_hash), ("splits", splits_by_hash)):
        if set(indexed) != expected:
            errors.append(f"{name}: hashes must exactly match inventory")

    source = next((item for item in registry.get("sources", []) if item.get("id") == identity[0]), None)
    approved = bool(source and source.get("decision") == "approved")
    group_splits: dict[str, str] = {}
    flight_ids: set[str] = set()
    for digest in expected & set(labels_by_hash) & set(groups_by_hash) & set(splits_by_hash):
        label = labels_by_hash[digest]
        group = groups_by_hash[digest]
        split = splits_by_hash[digest]
        flight_id = label.get("flight_id")
        if flight_id != group.get("flight_id") or flight_id != split.get("flight_id"):
            errors.append(f"{digest}: inconsistent flight_id")
        if flight_id in flight_ids:
            errors.append(f"duplicate flight_id: {flight_id}")
        flight_ids.add(flight_id)
        group_id = group.get("group_id")
        if group_id != split.get("group_id"):
            errors.append(f"{flight_id}: inconsistent group_id")
        partition = split.get("split")
        if partition not in ALL_SPLITS:
            errors.append(f"{flight_id}: invalid split")
            continue
        if group_id in group_splits and group_splits[group_id] != partition:
            errors.append(f"{group_id}: collection group crosses splits")
        group_splits[group_id] = partition
        if partition in ACTIVE_SPLITS and not approved:
            errors.append(f"{flight_id}: non-approved source assigned to active split")
        if partition in ACTIVE_SPLITS and label.get("training_eligible") is not True:
            errors.append(f"{flight_id}: ineligible label assigned to active split")
        if label.get("window_label") == "unknown" and partition != "excluded":
            errors.append(f"{flight_id}: unknown label must be excluded")
        if partition == "excluded" and not split.get("reason"):
            errors.append(f"{flight_id}: excluded record requires a reason")

    if splits.get("status") == "frozen" and not splits.get("frozen_at"):
        errors.append("splits: frozen_at is required for a frozen manifest")
    if splits.get("training_authorized") is True and not approved:
        errors.append("splits: training cannot be authorized for a non-approved source")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("groups", type=Path)
    parser.add_argument("splits", type=Path)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("labels", type=Path)
    parser.add_argument("registry", type=Path)
    args = parser.parse_args()
    documents = [json.loads(path.read_text(encoding="utf-8")) for path in vars(args).values()]
    errors = validate(*documents)
    if errors:
        print("Split validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Split manifest valid: {len(documents[1]['records'])} flights; training authorized={documents[1]['training_authorized']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
