#!/usr/bin/env python3
"""Validate a bounded Phase C pilot authorization against the source registry."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

MAX_PILOT_FLIGHTS = 5
MAX_PILOT_BYTES = 1024**3
PRECHECKS = ("license", "provenance", "privacy")


def validate_authorization(authorization: Mapping[str, Any], registry: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    source_id = authorization.get("source_id")
    sources = [source for source in registry.get("sources", []) if source.get("id") == source_id]
    if len(sources) != 1:
        return ["source_id must identify exactly one registry source"]
    source = sources[0]

    if authorization.get("schema_version") != "1.0.0":
        errors.append("schema_version must be 1.0.0")
    version = authorization.get("source_version")
    if not isinstance(version, str) or not version.strip() or "required" in version.lower():
        errors.append("source_version must be an immutable release or revision")
    if authorization.get("purpose") != "phase_c_parser_and_inventory_pilot":
        errors.append("purpose must be phase_c_parser_and_inventory_pilot")
    if authorization.get("status") != "authorized":
        errors.append("authorization status must be authorized")
    if not authorization.get("authorized_by") or not authorization.get("authorized_at"):
        errors.append("authorization reviewer and timestamp are required")

    limits = authorization.get("limits", {})
    flights = limits.get("maximum_flights")
    byte_limit = limits.get("maximum_download_bytes")
    if type(flights) is not int or not 1 <= flights <= MAX_PILOT_FLIGHTS:
        errors.append(f"maximum_flights must be between 1 and {MAX_PILOT_FLIGHTS}")
    if type(byte_limit) is not int or not 1 <= byte_limit <= MAX_PILOT_BYTES:
        errors.append(f"maximum_download_bytes must be between 1 and {MAX_PILOT_BYTES}")
    if limits.get("bulk_download_allowed") is not False:
        errors.append("bulk_download_allowed must be false")

    if source.get("decision") == "rejected":
        errors.append("rejected registry source cannot receive pilot authorization")
    checks = source.get("checks", {})
    for check in PRECHECKS:
        if checks.get(check) is not True:
            errors.append(f"registry precheck is incomplete: {check}")
    commercial_use = source.get("license", {}).get("commercial_use")
    if registry.get("commercial_compatibility_required") is True and commercial_use != "allowed":
        errors.append("source license is not confirmed commercially compatible")

    declared_checks = authorization.get("registry_checks", {})
    for check in ("license_reviewed", "provenance_reviewed", "privacy_plan_reviewed"):
        if declared_checks.get(check) is not True:
            errors.append(f"authorization check must be true: {check}")
    return errors


def validate_proposal_binding(authorization: Mapping[str, Any], proposal: Mapping[str, Any], proposal_bytes: bytes) -> list[str]:
    errors: list[str] = []
    binding = authorization.get("proposal")
    if not isinstance(binding, Mapping):
        return ["authorization must include a proposal binding"]
    digest = hashlib.sha256(proposal_bytes).hexdigest()
    if binding.get("sha256") != digest:
        errors.append("proposal SHA-256 does not match authorization")
    if proposal.get("status") != "proposal_only" or proposal.get("download_authorized") is not False:
        errors.append("bound proposal must be non-authorizing")
    if (proposal.get("source_id"), proposal.get("source_version")) != (authorization.get("source_id"), authorization.get("source_version")):
        errors.append("proposal source identity does not match authorization")
    records = proposal.get("records", [])
    if binding.get("candidate_count") != len(records):
        errors.append("proposal candidate count does not match authorization")
    limits = authorization.get("limits", {})
    total_bytes = proposal.get("summary", {}).get("total_bytes")
    if len(records) > limits.get("maximum_flights", 0):
        errors.append("proposal exceeds authorized flight count")
    if not isinstance(total_bytes, int) or total_bytes > limits.get("maximum_download_bytes", 0):
        errors.append("proposal exceeds authorized byte count")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("authorization", type=Path)
    parser.add_argument("--registry", type=Path, default=Path(__file__).parents[1] / "manifests" / "dataset_registry.json")
    parser.add_argument("--proposal", type=Path)
    args = parser.parse_args()
    authorization = json.loads(args.authorization.read_text(encoding="utf-8"))
    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    errors = validate_authorization(authorization, registry)
    if authorization.get("proposal"):
        if args.proposal is None:
            errors.append("--proposal is required for a proposal-bound authorization")
        else:
            proposal_bytes = args.proposal.read_bytes()
            proposal = json.loads(proposal_bytes)
            errors.extend(validate_proposal_binding(authorization, proposal, proposal_bytes))
    if errors:
        print("Pilot authorization denied:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Pilot authorization valid: {authorization['source_id']} @ {authorization['source_version']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
