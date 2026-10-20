#!/usr/bin/env python3
"""Download only a checksum-bound, authorized neutral candidate batch."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path

from validate_pilot_authorization import validate_authorization, validate_proposal_binding


def validate_private_mapping(proposal: dict, private_map: dict) -> list[str]:
    errors = []
    ids = {record["candidate_id"] for record in proposal.get("records", [])}
    mapped = set(private_map.get("mapping", {}))
    if ids != mapped:
        errors.append("private candidate mapping must exactly match proposal IDs")
    if (private_map.get("source_id"), private_map.get("source_version")) != (proposal.get("source_id"), proposal.get("source_version")):
        errors.append("private mapping source identity does not match proposal")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("authorization", type=Path)
    parser.add_argument("proposal", type=Path)
    parser.add_argument("private_map", type=Path)
    parser.add_argument("registry", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--repository", required=True)
    args = parser.parse_args()
    auth = json.loads(args.authorization.read_text(encoding="utf-8"))
    proposal_bytes = args.proposal.read_bytes()
    proposal = json.loads(proposal_bytes)
    private_map = json.loads(args.private_map.read_text(encoding="utf-8"))
    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    errors = validate_authorization(auth, registry)
    errors.extend(validate_proposal_binding(auth, proposal, proposal_bytes))
    errors.extend(validate_private_mapping(proposal, private_map))
    if errors:
        raise SystemExit("Authorization failed: " + "; ".join(errors))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if any(args.output_dir.iterdir()):
        raise SystemExit("Output directory must be empty")
    by_id = {record["candidate_id"]: record for record in proposal["records"]}
    total = 0
    results = []
    base = f"https://huggingface.co/datasets/{args.repository}/resolve/{auth['source_version']}/"
    for candidate_id in sorted(by_id):
        expected = by_id[candidate_id]["size_bytes"]
        if total + expected > auth["limits"]["maximum_download_bytes"]:
            raise SystemExit("Authorized byte ceiling would be exceeded")
        locator = private_map["mapping"][candidate_id]
        url = base + urllib.parse.quote(locator, safe="/")
        target = args.output_dir / f"{candidate_id}.ulg"
        temporary = target.with_suffix(".ulg.part")
        digest = hashlib.sha256()
        received = 0
        try:
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as handle:
                while chunk := response.read(1024 * 1024):
                    received += len(chunk)
                    if received > expected:
                        raise ValueError("download exceeded declared file size")
                    digest.update(chunk)
                    handle.write(chunk)
            if received != expected:
                raise ValueError(f"size mismatch: expected {expected}, received {received}")
            temporary.replace(target)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        total += received
        results.append({"candidate_id": candidate_id, "size_bytes": received, "sha256": digest.hexdigest()})
    receipt = {"source_id": auth["source_id"], "source_version": auth["source_version"], "total_bytes": total, "files": results}
    (args.output_dir.parent / "download-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"Downloaded {len(results)} authorized files, {total} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
