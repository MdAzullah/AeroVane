"""Portable AeroVane decision-tree model contract and reference scorer."""

from __future__ import annotations

import math


SCHEMA_VERSION = "1.0.0"
MODEL_KIND = "binary-decision-tree"


def validate_artifact(artifact: dict) -> None:
    required = {"schema_version", "model_kind", "version", "features", "imputation_medians", "tree", "persistence_windows", "advisory_only"}
    missing = required - artifact.keys()
    if missing:
        raise ValueError(f"model artifact missing fields: {sorted(missing)}")
    if artifact["schema_version"] != SCHEMA_VERSION or artifact["model_kind"] != MODEL_KIND:
        raise ValueError("unsupported model contract")
    features = artifact["features"]
    medians = artifact["imputation_medians"]
    tree = artifact["tree"]
    if not features or len(features) != len(set(features)) or len(medians) != len(features):
        raise ValueError("features and imputation medians must be nonempty and aligned")
    if artifact["advisory_only"] is not True or not isinstance(artifact["persistence_windows"], int) or artifact["persistence_windows"] < 1:
        raise ValueError("artifact violates advisory or persistence contract")
    node_count = len(tree.get("feature_index", []))
    aligned = ("threshold", "left", "right", "anomaly_probability")
    if node_count == 0 or any(len(tree.get(name, [])) != node_count for name in aligned):
        raise ValueError("tree arrays must be nonempty and aligned")
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in medians + tree["threshold"] + tree["anomaly_probability"]):
        raise ValueError("model numeric values must be finite")
    for index, feature_index in enumerate(tree["feature_index"]):
        leaf = feature_index == -1
        if leaf:
            if tree["left"][index] != -1 or tree["right"][index] != -1:
                raise ValueError("leaf nodes cannot have children")
        elif not (0 <= feature_index < len(features) and 0 <= tree["left"][index] < node_count and 0 <= tree["right"][index] < node_count):
            raise ValueError("invalid decision-tree node")
        if not 0.0 <= tree["anomaly_probability"][index] <= 1.0:
            raise ValueError("anomaly probabilities must be within [0, 1]")


def score(artifact: dict, values: list[float | None]) -> float:
    validate_artifact(artifact)
    if len(values) != len(artifact["features"]):
        raise ValueError("feature vector length differs from model contract")
    filled = [artifact["imputation_medians"][i] if value is None or not math.isfinite(value) else value for i, value in enumerate(values)]
    tree = artifact["tree"]
    node = 0
    for _ in range(len(tree["feature_index"]) + 1):
        feature_index = tree["feature_index"][node]
        if feature_index == -1:
            return tree["anomaly_probability"][node]
        node = tree["left"][node] if filled[feature_index] <= tree["threshold"][node] else tree["right"][node]
    raise ValueError("tree traversal exceeded node count")


def pipeline_to_artifact(pipeline, *, features: list[str], version: str, persistence_windows: int, lineage: dict) -> dict:
    imputer = pipeline.named_steps["simpleimputer"]
    estimator = pipeline.named_steps["decisiontreeclassifier"]
    tree = estimator.tree_
    probabilities = []
    anomaly_index = list(estimator.classes_).index(1)
    for counts in tree.value[:, 0, :]:
        total = float(sum(counts))
        probabilities.append(float(counts[anomaly_index] / total) if total else 0.0)
    artifact = {
        "schema_version": SCHEMA_VERSION,
        "model_kind": MODEL_KIND,
        "version": version,
        "advisory_only": True,
        "features": features,
        "imputation_medians": [float(value) for value in imputer.statistics_],
        "persistence_windows": persistence_windows,
        "decision_threshold": 0.5,
        "lineage": lineage,
        "tree": {
            "feature_index": [-1 if tree.children_left[index] == -1 else int(value) for index, value in enumerate(tree.feature)],
            "threshold": [float(value) for value in tree.threshold],
            "left": [int(value) for value in tree.children_left],
            "right": [int(value) for value in tree.children_right],
            "anomaly_probability": probabilities,
        },
    }
    validate_artifact(artifact)
    return artifact
