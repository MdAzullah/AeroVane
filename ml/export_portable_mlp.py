#!/usr/bin/env python3
"""Export the BASiC PyTorch MLP to a language-neutral advisory artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path); parser.add_argument("report", type=Path); parser.add_argument("output", type=Path)
    args = parser.parse_args()
    saved = torch.load(args.model, map_location="cpu", weights_only=False)
    report_hash = hashlib.sha256(args.report.read_bytes()).hexdigest()
    state = saved["state_dict"]
    layer_indexes = sorted({int(key.split(".")[1]) for key in state if key.endswith(".weight")})
    layers = []
    for index in layer_indexes:
        layers.append({"activation": "softmax" if index == layer_indexes[-1] else "relu",
                       "weights": state[f"network.{index}.weight"].numpy().astype(float).tolist(),
                       "bias": state[f"network.{index}.bias"].numpy().astype(float).tolist()})
    artifact = {"schema_version": "1.0.0", "model_kind": "multiclass-dense-network",
                "version": "skyforge-basic-sensor-1.0.0", "advisory_only": True,
                "simulation_trained": True, "component_diagnosis": False,
                "features": saved["features"], "classes": saved["classes"],
                "imputation_medians": np.asarray(saved["medians"], dtype=float).tolist(),
                "standardization_means": np.asarray(saved["means"], dtype=float).tolist(),
                "standardization_scales": np.asarray(saved["scales"], dtype=float).tolist(),
                "unknown_confidence_threshold": float(saved["unknown_confidence_threshold"]),
                "minimum_observed_signal_families": 4, "layers": layers,
                "lineage": {"experiment": "basic-simulated-sensor-classifier-1", "report_sha256": report_hash,
                            "model_sha256": hashlib.sha256(args.model.read_bytes()).hexdigest()}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"features": len(artifact["features"]), "classes": artifact["classes"], "layers": [len(x["bias"]) for x in layers], "bytes": args.output.stat().st_size}, indent=2))
    return 0


if __name__ == "__main__": raise SystemExit(main())
