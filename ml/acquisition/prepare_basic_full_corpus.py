#!/usr/bin/env python3
"""Acquire the checksum-pinned BASiC corpus using neutral local filenames."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RECORD_ID = "8199999"
API = f"https://zenodo.org/api/records/{RECORD_ID}"
CLASSES = {
    "No Failure": "normal",
    "RC Failure": "rc_failure",
    "GPS Failure": "gps_failure",
    "Accelerometer Failure": "accelerometer_failure",
    "Gyro Failure": "gyroscope_failure",
    "Compass Failure": "compass_failure",
    "Barometer Failure": "barometer_failure",
}
NAME = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}) \(([^)]+)\)\.log$")


def digest(path: Path, algorithm: str) -> str:
    value = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def load_metadata(path: Path | None) -> dict:
    if path:
        return json.loads(path.read_text(encoding="utf-8"))
    with urllib.request.urlopen(API) as response:
        return json.load(response)


def records(metadata: dict) -> list[dict]:
    parsed = []
    for item in metadata["files"]:
        match = NAME.match(item["key"])
        if not match or match.group(2) not in CLASSES:
            raise SystemExit(f"unexpected BASiC filename: {item['key']}")
        parsed.append({"upstream_name": item["key"], "timestamp": match.group(1),
                       "class": CLASSES[match.group(2)], "bytes": item["size"],
                       "md5": item["checksum"].removeprefix("md5:"),
                       "url": item["links"].get("content", item["links"].get("self"))})
        if not parsed[-1]["url"]:
            raise SystemExit(f"official metadata has no content URL for {item['key']}")
    parsed.sort(key=lambda item: item["timestamp"])
    if len(parsed) != 70:
        raise SystemExit(f"expected 70 BASiC files, found {len(parsed)}")
    expected = set(CLASSES.values())
    for group_index in range(10):
        group = parsed[group_index * 7:(group_index + 1) * 7]
        if {item["class"] for item in group} != expected:
            raise SystemExit(f"location cohort {group_index + 1} does not contain all seven classes")
        for item in group:
            item["group_id"] = f"basic-location-{group_index + 1:02d}"
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--authorization", type=Path)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    metadata = load_metadata(args.metadata)
    if metadata["metadata"].get("license", {}).get("id") != "cc-by-4.0":
        raise SystemExit("official record no longer declares CC BY 4.0")
    source = records(metadata)
    if args.download:
        if not args.authorization:
            raise SystemExit("--authorization is required for download")
        authorization = json.loads(args.authorization.read_text(encoding="utf-8"))
        expected_bytes = sum(item["bytes"] for item in source)
        if (authorization.get("source_id") != "basic-zenodo-8199999"
                or authorization.get("download_authorized") is not True
                or authorization.get("candidate_count") != len(source)
                or authorization.get("maximum_bytes") != expected_bytes):
            raise SystemExit("authorization does not exactly bind the official BASiC corpus")
    args.output.mkdir(parents=True, exist_ok=True)
    if args.download:
        def acquire(entry: tuple[int, dict]) -> None:
            index, item = entry
            destination = args.output / f"basic-flight-{index:03d}.log"
            if destination.exists() and destination.stat().st_size == item["bytes"] and digest(destination, "md5") == item["md5"]:
                return
            partial = destination.with_suffix(".log.part")
            if partial.exists(): partial.unlink()
            urllib.request.urlretrieve(item["url"], partial)
            if partial.stat().st_size != item["bytes"] or digest(partial, "md5") != item["md5"]:
                raise SystemExit(f"checksum or size mismatch: basic-flight-{index:03d}")
            partial.replace(destination)
        with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 10))) as pool:
            list(pool.map(acquire, enumerate(source, 1)))
    public = []
    for index, item in enumerate(source, 1):
        flight_id = f"basic-flight-{index:03d}"
        filename = f"{flight_id}.log"
        destination = args.output / filename
        sha256 = None
        if destination.exists():
            if destination.stat().st_size != item["bytes"] or digest(destination, "md5") != item["md5"]:
                raise SystemExit(f"checksum or size mismatch: {flight_id}")
            sha256 = digest(destination, "sha256")
        public.append({"flight_id": flight_id, "group_id": item["group_id"],
                       "class": item["class"], "bytes": item["bytes"],
                       "upstream_md5": item["md5"], "sha256": sha256})
    manifest = {"schema_version": "1.0.0", "source_id": "basic-zenodo-8199999",
                "source_version": "1", "license": "CC-BY-4.0", "record_id": RECORD_ID,
                "training_scope": "simulation-only multicopter sensor-fault development",
                "real_flight_claim_authorized": False, "records": public}
    rendered = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    if args.manifest:
        args.manifest.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    downloaded = sum(item["sha256"] is not None for item in public)
    print(f"Validated {downloaded}/70 files; {sum(item['bytes'] for item in public)} authorized bytes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
