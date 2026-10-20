#!/usr/bin/env python3
"""Train a location-held-out BASiC simulation sensor-fault classifier."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn


def split_rows(rows: list[dict], config: dict) -> dict[str, list[dict]]:
    assignments = {group: split for split, key in (("train", "train_groups"), ("validation", "validation_groups"), ("test", "test_groups")) for group in config["splits"][key]}
    result = {"train": [], "validation": [], "test": []}
    for row in rows:
        if row.get("eligible") and row["label"] in config["classes"]:
            split = assignments.get(row["group_id"])
            if split: result[split].append(row)
    return result


def macro_f1(labels: np.ndarray, predictions: np.ndarray, class_count: int) -> float:
    values = []
    for cls in range(class_count):
        tp = int(np.sum((labels == cls) & (predictions == cls)))
        fp = int(np.sum((labels != cls) & (predictions == cls)))
        fn = int(np.sum((labels == cls) & (predictions != cls)))
        values.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0)
    return float(np.mean(values))


class Classifier(nn.Module):
    def __init__(self, inputs: int, hidden: list[int], outputs: int, dropout: float):
        super().__init__(); layers = []; width = inputs
        for target in hidden:
            layers.extend([nn.Linear(width, target), nn.ReLU(), nn.Dropout(dropout)]); width = target
        layers.append(nn.Linear(width, outputs)); self.network = nn.Sequential(*layers)

    def forward(self, values: torch.Tensor) -> torch.Tensor: return self.network(values)


def arrays(rows: list[dict], classes: list[str], medians=None, means=None, scales=None):
    x = np.asarray([[np.nan if value is None else value for value in row["features"]] for row in rows], dtype=np.float32)
    if medians is None: medians = np.nanmedian(x, axis=0); medians = np.where(np.isfinite(medians), medians, 0.0)
    x = np.where(np.isfinite(x), x, medians)
    if means is None: means = x.mean(axis=0)
    if scales is None: scales = x.std(axis=0); scales = np.where(scales > 1e-6, scales, 1.0)
    x = np.clip((x - means) / scales, -10, 10).astype(np.float32)
    y = np.asarray([classes.index(row["label"]) for row in rows], dtype=np.int64)
    return x, y, medians, means, scales


def evaluate(model, x, y, rows, classes, threshold, device):
    model.eval()
    with torch.no_grad(): probabilities = torch.softmax(model(torch.from_numpy(x).to(device)), 1).cpu().numpy()
    prediction = probabilities.argmax(1); confidence = probabilities.max(1); prediction[confidence < threshold] = -1
    accepted = prediction >= 0
    per_flight = defaultdict(list)
    for index, row in enumerate(rows): per_flight[row["flight_id"]].append(index)
    flight_scores = [macro_f1(y[indexes], prediction[indexes], len(classes)) for indexes in per_flight.values()]
    confusion = [[int(np.sum((y == actual) & (prediction == predicted))) for predicted in range(len(classes))] for actual in range(len(classes))]
    return {"samples": len(y), "accuracy": float(np.mean(prediction == y)), "macro_f1": macro_f1(y, prediction, len(classes)),
            "per_flight_macro_f1": float(np.mean(flight_scores)), "unknown_rate": float(np.mean(~accepted)),
            "confusion": confusion, "class_counts": dict(Counter(rows[index]["label"] for index in range(len(rows))))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("windows", type=Path); parser.add_argument("preprocessing_report", type=Path); parser.add_argument("config", type=Path)
    parser.add_argument("model", type=Path); parser.add_argument("report", type=Path); args = parser.parse_args()
    config = json.loads(args.config.read_text()); prep = json.loads(args.preprocessing_report.read_text())
    rows = [json.loads(line) for line in args.windows.read_text().splitlines() if line.strip()]
    splits = split_rows(rows, config); classes = config["classes"]
    if any(not splits[name] for name in splits): raise SystemExit("every location-held-out split must contain eligible windows")
    seed = config["random_seed"]; random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    if torch.cuda.is_available(): torch.cuda.manual_seed_all(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_x, train_y, medians, means, scales = arrays(splits["train"], classes)
    val_x, val_y, *_ = arrays(splits["validation"], classes, medians, means, scales)
    test_x, test_y, *_ = arrays(splits["test"], classes, medians, means, scales)
    model = Classifier(train_x.shape[1], config["hidden_units"], len(classes), config["dropout"]).to(device)
    counts = np.bincount(train_y, minlength=len(classes)); weights = len(train_y) / (len(classes) * counts)
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device))
    optimizer = torch.optim.AdamW(model.parameters(), lr=config["learning_rate"], weight_decay=config["weight_decay"])
    generator = torch.Generator().manual_seed(seed)
    loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(torch.from_numpy(train_x), torch.from_numpy(train_y)), batch_size=config["batch_size"], shuffle=True, generator=generator)
    best = (-1.0, None, 0); stale = 0
    for epoch in range(1, config["maximum_epochs"] + 1):
        model.train()
        for batch_x, batch_y in loader:
            optimizer.zero_grad(); loss = loss_fn(model(batch_x.to(device)), batch_y.to(device)); loss.backward(); optimizer.step()
        model.eval()
        with torch.no_grad(): val_prediction = model(torch.from_numpy(val_x).to(device)).argmax(1).cpu().numpy()
        score = macro_f1(val_y, val_prediction, len(classes))
        if score > best[0] + 1e-6: best = (score, copy.deepcopy(model.state_dict()), epoch); stale = 0
        else: stale += 1
        if stale >= config["early_stopping_patience"]: break
    model.load_state_dict(best[1])
    metrics = {name: evaluate(model, values[0], values[1], splits[name], classes, config["unknown_confidence_threshold"], device)
               for name, values in {"train": (train_x, train_y), "validation": (val_x, val_y), "test": (test_x, test_y)}.items()}
    args.model.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.cpu().state_dict(), "classes": classes, "features": prep["features"], "medians": medians, "means": means, "scales": scales,
                "unknown_confidence_threshold": config["unknown_confidence_threshold"]}, args.model)
    report = {"schema_version": "1.0.0", "experiment": config["experiment"], "device": str(device),
              "device_name": torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU",
              "torch_version": torch.__version__, "numpy_version": np.__version__, "best_epoch": best[2],
              "splits": config["splits"], "metrics": metrics, "classes": classes, "features": len(prep["features"]),
              "claims": config["claims"], "release_authorized": False, "model_sha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
              "limitations": ["BASiC is simulated ArduCopter data.", "Only two location groups are held out for test.", "RC failure is excluded because no unambiguous in-log onset was established.", "Low-confidence outputs abstain as unknown anomaly."]}
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"device": str(device), "best_epoch": best[2], "metrics": metrics}, indent=2)); return 0


if __name__ == "__main__": raise SystemExit(main())
