#!/usr/bin/env python3
"""Dependency-free admission checks for the AeroVane dataset registry."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "manifests" / "dataset_registry.json"
TAXONOMY = ROOT / "configs" / "taxonomy.json"
REQUIRED_CHECKS = {"license", "provenance", "privacy", "integrity", "schema", "duplicates"}
DECISIONS = {"approved", "quarantined", "rejected"}


def validate(data: dict, taxonomy: dict | None = None) -> list[str]:
    errors: list[str] = []
    if data.get("schema_version") != "1.0.0":
        errors.append("schema_version must be 1.0.0")
    if data.get("commercial_compatibility_required") is not True:
        errors.append("commercial_compatibility_required must be true")

    sources = data.get("sources")
    if not isinstance(sources, list) or not sources:
        return errors + ["sources must be a non-empty list"]

    seen: set[str] = set()
    known_families = {
        item["id"] for item in (taxonomy or {}).get("vehicle_families", [])
        if isinstance(item, dict) and "id" in item
    }
    for index, source in enumerate(sources):
        label = source.get("id", f"source[{index}]")
        if label in seen:
            errors.append(f"{label}: duplicate id")
        seen.add(label)
        if source.get("decision") not in DECISIONS:
            errors.append(f"{label}: invalid decision")
        if not source.get("decision_reason"):
            errors.append(f"{label}: decision_reason is required")
        if not source.get("citation") or not source.get("provenance"):
            errors.append(f"{label}: citation and provenance are required")
        audit = source.get("license_audit", {})
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(audit.get("reviewed_at", ""))):
            errors.append(f"{label}: license audit date is required")
        if not audit.get("evidence") or not audit.get("finding"):
            errors.append(f"{label}: license audit evidence and finding are required")
        if not source.get("vehicle_families"):
            errors.append(f"{label}: at least one vehicle family is required")
        elif known_families and not set(source["vehicle_families"]).issubset(known_families):
            errors.append(f"{label}: unknown vehicle family")
        checks = source.get("checks", {})
        if set(checks) != REQUIRED_CHECKS or any(type(value) is not bool for value in checks.values()):
            errors.append(f"{label}: all six admission checks must be booleans")
        if source.get("decision") == "approved":
            if not all(checks.values()):
                errors.append(f"{label}: approved source has incomplete checks")
            if source.get("license", {}).get("commercial_use") != "allowed":
                errors.append(f"{label}: approved source is not commercially compatible")
            uses = set(source.get("allowed_uses", []))
            if not uses.intersection({"training", "evaluation", "parser_testing"}):
                errors.append(f"{label}: approved source has no payload use")
        elif set(source.get("allowed_uses", [])) - {"metadata_review"}:
            errors.append(f"{label}: non-approved source permits payload use")
    return errors


def main() -> int:
    with REGISTRY.open(encoding="utf-8") as handle:
        registry = json.load(handle)
    with TAXONOMY.open(encoding="utf-8") as handle:
        taxonomy = json.load(handle)
    errors = validate(registry, taxonomy)
    if errors:
        print("Dataset registry validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    admitted = sum(source["decision"] == "approved" for source in registry["sources"])
    print(f"Dataset registry valid: {len(registry['sources'])} sources; {admitted} currently admitted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
