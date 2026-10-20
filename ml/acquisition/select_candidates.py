#!/usr/bin/env python3
"""Propose a privacy-minimal, label-stratified five-file acquisition batch."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
from pathlib import Path
from typing import Any, Mapping

ANOMALY_CLASSES = {"Altitude", "External Position", "Global Position", "Mechanical"}
MAX_FILES = 5
MAX_BYTES = 512 * 1024 * 1024


def token(secret: bytes, prefix: str, value: str) -> str:
    digest = hmac.new(secret, value.encode("utf-8"), hashlib.sha256).hexdigest()[:20]
    return f"{prefix}-{digest}"


def _file_metadata(index: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    result = {}
    for item in index.get("siblings", []):
        name = item.get("rfilename", "")
        if name.endswith(".ulg"):
            result[name] = item
    return result


def _locator(mapping_key: str) -> str:
    return f"ulg_files/{mapping_key}.ulg"


def _size(item: Mapping[str, Any]) -> int | None:
    value = item.get("size")
    if isinstance(value, int):
        return value
    lfs = item.get("lfs") or {}
    value = lfs.get("size")
    return value if isinstance(value, int) else None


def candidates(mapping: Mapping[str, Any], index: Mapping[str, Any], secret: bytes, excluded: set[str]) -> list[dict[str, Any]]:
    files = _file_metadata(index)
    result = []
    for mapping_key, document in mapping.items():
        locator = _locator(mapping_key)
        if locator in excluded or locator not in files:
            continue
        annotations = document.get("annotations", [])
        classes = sorted({item.get("class") for item in annotations if item.get("class")})
        ranges = [interval for item in annotations for _, intervals in item.get("ranges", []) for interval in intervals]
        ranged_anomaly = bool(ranges) and any(name in ANOMALY_CLASSES for name in classes)
        normal = classes == ["Normal"] and not ranges
        if not (ranged_anomaly or normal):
            continue
        size = _size(files[locator])
        if size is None or size <= 0 or size > MAX_BYTES:
            continue
        parent = mapping_key.rsplit("/", 1)[0] if "/" in mapping_key else "unknown-top-level-cohort"
        result.append({
            "locator": locator,
            "locator_token": token(secret, "src", locator),
            "group_id": token(secret, "grp", parent),
            "label": "anomalous" if ranged_anomaly else "normal",
            "source_classes": classes,
            "range_count": len(ranges),
            "size_bytes": size,
        })
    return result


def select(
    pool: list[dict[str, Any]], maximum_files: int = MAX_FILES, maximum_bytes: int = MAX_BYTES,
    prior_groups: set[str] | None = None,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    used_groups: set[str] = set(prior_groups or ())
    total = 0
    targets = ("anomalous", "anomalous", "anomalous", "normal", "normal")
    for wanted in targets[:maximum_files]:
        options = [item for item in pool if item["label"] == wanted and item not in selected and total + item["size_bytes"] <= maximum_bytes]
        options.sort(key=lambda item: (item["group_id"] in used_groups, -item["range_count"], item["size_bytes"], item["locator_token"]))
        if not options:
            continue
        chosen = options[0]
        selected.append(chosen)
        used_groups.add(chosen["group_id"])
        total += chosen["size_bytes"]
    return selected


def build_outputs(selected: list[dict[str, Any]], source_id: str, source_version: str) -> tuple[dict[str, Any], dict[str, Any]]:
    public_records, private_mapping = [], {}
    for index, item in enumerate(selected, 1):
        candidate_id = f"candidate-{index:03d}"
        public_records.append({key: item[key] for key in ("locator_token", "group_id", "label", "source_classes", "range_count", "size_bytes")} | {"candidate_id": candidate_id})
        private_mapping[candidate_id] = item["locator"]
    public = {
        "schema_version": "1.0.0", "status": "proposal_only",
        "source_id": source_id, "source_version": source_version,
        "download_authorized": False, "maximum_files": MAX_FILES,
        "maximum_bytes": MAX_BYTES, "records": public_records,
        "summary": {"file_count": len(public_records), "total_bytes": sum(item["size_bytes"] for item in selected), "labels": {label: sum(item["label"] == label for item in selected) for label in ("normal", "anomalous")}, "group_count": len({item["group_id"] for item in selected})},
    }
    private = {"source_id": source_id, "source_version": source_version, "mapping": private_mapping}
    return public, private


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mapping", type=Path)
    parser.add_argument("repository_index", type=Path)
    parser.add_argument("secret", type=Path)
    parser.add_argument("public_output", type=Path)
    parser.add_argument("private_output", type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--source-version", required=True)
    parser.add_argument(
        "--exclude-private-map", type=Path, action="append", default=[],
        help="Prior private source map to exclude; repeat for every acquired cohort",
    )
    args = parser.parse_args()
    excluded: set[str] = set()
    for path in args.exclude_private_map:
        prior = json.loads(path.read_text(encoding="utf-8"))
        excluded.update(prior.get("mapping", {}).values())
    prior_groups = set()
    for locator in excluded:
        if locator.startswith("ulg_files/") and locator.endswith(".ulg"):
            mapping_key = locator[len("ulg_files/"):-len(".ulg")]
            parent = mapping_key.rsplit("/", 1)[0] if "/" in mapping_key else "unknown-top-level-cohort"
            prior_groups.add(token(args.secret.read_bytes(), "grp", parent))
    mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
    repository_index = json.loads(args.repository_index.read_text(encoding="utf-8"))
    selected = select(candidates(mapping, repository_index, args.secret.read_bytes(), excluded), prior_groups=prior_groups)
    public, private = build_outputs(selected, args.source_id, args.source_version)
    args.public_output.parent.mkdir(parents=True, exist_ok=True)
    args.private_output.parent.mkdir(parents=True, exist_ok=True)
    args.public_output.write_text(json.dumps(public, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.private_output.write_text(json.dumps(private, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Proposed {public['summary']['file_count']} files, {public['summary']['total_bytes']} bytes; download_authorized=False")
    return 0 if len(selected) == MAX_FILES else 1


if __name__ == "__main__":
    raise SystemExit(main())
