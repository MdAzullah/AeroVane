#!/usr/bin/env python3
"""Export an accepted local research pipeline to portable JSON without reevaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib

from model_contract import pipeline_to_artifact


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pipeline", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("refusing to overwrite portable model artifact")
    report = json.loads(args.report.read_text(encoding="utf-8"))
    if report.get("accepted") is not True or report.get("test_evaluations") != 1:
        raise SystemExit("portable export requires an accepted, once-evaluated report")
    payload = joblib.load(args.pipeline)
    selected = report["selected"]
    if payload["features"] != report["features"] or payload["persistence_windows"] != selected["persistence_windows"]:
        raise SystemExit("pipeline metadata differs from accepted report")
    artifact = pipeline_to_artifact(
        payload["model"], features=payload["features"], version="skyforge-real-anomaly-2.0.0",
        persistence_windows=payload["persistence_windows"],
        lineage={"experiment": report["experiment"], "report_sha256": digest(args.report), "config_sha256": report["config_sha256"]},
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"version": artifact["version"], "nodes": len(artifact["tree"]["feature_index"]), "output": str(args.output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
