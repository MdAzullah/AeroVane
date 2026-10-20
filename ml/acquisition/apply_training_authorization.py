#!/usr/bin/env python3
"""Apply a checksum-bound training authorization to an exact frozen split."""

import argparse
import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("authorization", type=Path)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("labels", type=Path)
    parser.add_argument("groups", type=Path)
    parser.add_argument("splits", type=Path)
    parser.add_argument("quality", type=Path)
    args = parser.parse_args()
    auth = json.loads(args.authorization.read_text())
    splits = json.loads(args.splits.read_text())
    errors = []
    if auth.get("status") != "authorized" or auth.get("purpose") != "first_controlled_real_data_experiment":
        errors.append("authorization status or purpose is invalid")
    if not auth.get("authorized_by") or not auth.get("authorized_at"):
        errors.append("authorization reviewer and timestamp are required")
    if splits.get("status") != "frozen" or splits.get("training_authorized") is not False:
        errors.append("input split must be frozen and not already authorized")
    identity = (splits.get("source_id"), splits.get("source_version"))
    if identity != (auth.get("source_id"), auth.get("source_version")):
        errors.append("authorization identity does not match split")
    bindings = auth.get("bindings", {})
    for name, path in (("inventory", args.inventory), ("labels", args.labels), ("groups", args.groups), ("feature_quality", args.quality)):
        if bindings.get(f"{name}_sha256") != digest(path):
            errors.append(f"{name} checksum binding failed")
    authorized = splits | {"training_authorized": True}
    rendered = json.dumps(authorized, indent=2, sort_keys=True) + "\n"
    if bindings.get("authorized_splits_sha256") != hashlib.sha256(rendered.encode()).hexdigest():
        errors.append("authorized split checksum binding failed")
    if errors:
        raise SystemExit("Training authorization rejected: " + "; ".join(errors))
    args.splits.write_text(rendered)
    print("Applied checksum-bound training authorization to frozen split manifest.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
