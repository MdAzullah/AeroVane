#!/usr/bin/env python3
"""Inspect ZIP/TAR pilot archives without extracting payloads."""

from __future__ import annotations

import argparse
import hashlib
import json
import stat
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable


@dataclass(frozen=True)
class Member:
    name: str
    compressed_size: int
    uncompressed_size: int
    is_link: bool = False
    encrypted: bool = False


def _unsafe_path(name: str) -> bool:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    return path.is_absolute() or any(part == ".." for part in path.parts) or bool(path.parts and ":" in path.parts[0])


def _zip_members(path: Path) -> Iterable[Member]:
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            mode = (info.external_attr >> 16) & 0xFFFF
            yield Member(
                info.filename,
                info.compress_size,
                info.file_size,
                stat.S_ISLNK(mode),
                bool(info.flag_bits & 0x1),
            )


def _tar_members(path: Path) -> Iterable[Member]:
    with tarfile.open(path, mode="r:*") as archive:
        for info in archive.getmembers():
            yield Member(info.name, max(0, info.size), max(0, info.size), info.issym() or info.islnk(), False)


def inspect_archive(
    path: Path,
    *,
    max_entries: int = 10_000,
    max_uncompressed_bytes: int = 20 * 1024**3,
    max_expansion_ratio: float = 200.0,
) -> dict:
    digest_builder = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest_builder.update(chunk)
    digest = digest_builder.hexdigest()
    lower_name = path.name.lower()
    try:
        if lower_name.endswith(".zip"):
            members = list(_zip_members(path))
            archive_format = "zip"
        elif any(lower_name.endswith(suffix) for suffix in (".tar", ".tar.gz", ".tgz", ".tar.xz", ".txz")):
            members = list(_tar_members(path))
            archive_format = "tar"
        else:
            return _report(path, digest, "unsupported", [], ["unsupported_archive_format"])
    except (zipfile.BadZipFile, tarfile.TarError, OSError, EOFError) as error:
        return _report(path, digest, "corrupt", [], [f"archive_parse_error:{type(error).__name__}"])

    findings: list[str] = []
    names: set[str] = set()
    for member in members:
        if _unsafe_path(member.name):
            findings.append(f"unsafe_path:{member.name}")
        if member.name in names:
            findings.append(f"duplicate_member_path:{member.name}")
        names.add(member.name)
        if member.is_link:
            findings.append(f"link_member:{member.name}")
        if member.encrypted:
            findings.append(f"encrypted_member:{member.name}")
        if member.compressed_size > 0 and member.uncompressed_size / member.compressed_size > max_expansion_ratio:
            findings.append(f"excessive_expansion:{member.name}")

    total_uncompressed = sum(member.uncompressed_size for member in members)
    if len(members) > max_entries:
        findings.append("too_many_entries")
    if total_uncompressed > max_uncompressed_bytes:
        findings.append("uncompressed_size_limit_exceeded")
    return _report(path, digest, archive_format, members, findings)


def _report(path: Path, digest: str, archive_format: str, members: list[Member], findings: list[str]) -> dict:
    unique_findings = sorted(set(findings))
    return {
        "schema_version": "1.0.0",
        "archive_name": path.name,
        "archive_sha256": digest,
        "archive_size_bytes": path.stat().st_size,
        "archive_format": archive_format,
        "safe_to_extract": not unique_findings,
        "member_count": len(members),
        "total_uncompressed_bytes": sum(member.uncompressed_size for member in members),
        "findings": unique_findings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.archive.is_file():
        parser.error("archive must be an existing file")
    report = inspect_archive(args.archive)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if report["safe_to_extract"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
