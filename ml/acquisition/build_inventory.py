#!/usr/bin/env python3
"""Build a deterministic, privacy-minimal Phase C inventory for local pilot files."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CHUNK_SIZE = 1024 * 1024


def classify(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".ulg":
        return "ulog"
    if suffix == ".bin":
        return "dataflash_bin"
    if suffix == ".log":
        return "dataflash_log"
    if suffix == ".tlog":
        return "tlog"
    if suffix in {".zip", ".tar", ".gz", ".xz", ".7z"}:
        return "archive"
    if suffix in {".csv", ".parquet", ".arrow"}:
        return "annotation"
    if suffix in {".json", ".yaml", ".yml", ".txt", ".md"}:
        return "metadata"
    return "unknown"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def build_inventory(root: Path, source_id: str, source_version: str, created_at: str) -> dict[str, Any]:
    root = root.resolve()
    files = sorted((path for path in root.rglob("*") if path.is_file()), key=lambda path: path.relative_to(root).as_posix())
    first_by_hash: dict[str, str] = {}
    entries: list[dict[str, Any]] = []
    formats: Counter[str] = Counter()
    unique_bytes = 0

    for path in files:
        relative = path.relative_to(root).as_posix()
        digest = sha256_file(path)
        size = path.stat().st_size
        duplicate_of = first_by_hash.get(digest)
        if duplicate_of is None:
            first_by_hash[digest] = relative
            unique_bytes += size
        file_format = classify(path)
        formats[file_format] += 1
        entries.append({
            "relative_path": relative,
            "size_bytes": size,
            "sha256": digest,
            "format": file_format,
            "duplicate_of": duplicate_of,
        })

    duplicate_count = sum(entry["duplicate_of"] is not None for entry in entries)
    return {
        "schema_version": "1.0.0",
        "created_at": created_at,
        "source_id": source_id,
        "source_version": source_version,
        "purpose": "phase_c_pilot_inventory",
        "files": entries,
        "summary": {
            "file_count": len(entries),
            "unique_file_count": len(entries) - duplicate_count,
            "duplicate_count": duplicate_count,
            "total_bytes": sum(entry["size_bytes"] for entry in entries),
            "unique_bytes": unique_bytes,
            "formats": dict(sorted(formats.items())),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Approved local pilot directory")
    parser.add_argument("output", type=Path, help="Versioned inventory JSON")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--source-version", required=True)
    parser.add_argument("--created-at", help="ISO-8601 UTC timestamp; defaults to now")
    args = parser.parse_args()
    if not args.root.is_dir():
        parser.error("root must be an existing directory")
    created_at = args.created_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    inventory = build_inventory(args.root, args.source_id, args.source_version, created_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Inventoried {inventory['summary']['file_count']} files ({inventory['summary']['unique_file_count']} unique)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
