#!/usr/bin/env python3
"""Build privacy-safe, location-grouped BASiC sensor-fault windows."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path

WINDOW_US = 5_000_000
BOUNDARY_US = 2_000_000
SIGNALS = {
    "GPS": ("NSats", "HDop", "Spd", "VZ"),
    "IMU": ("GyrX", "GyrY", "GyrZ", "AccX", "AccY", "AccZ", "T"),
    "MAG": ("MagX", "MagY", "MagZ"),
    "BARO": ("Alt", "Press", "Temp", "CRt"),
    "VIBE": ("VibeX", "VibeY", "VibeZ", "Clip"),
    "ATT": ("Roll", "Pitch", "Yaw", "DesRoll", "DesPitch", "DesYaw", "ErrRP", "ErrYaw"),
    "BAT": ("Volt", "Curr", "RemPct"),
    "RSSI": ("RXRSSI", "RXLQ"),
}
FAULTS = {"gps_failure", "accelerometer_failure", "gyroscope_failure", "compass_failure", "barometer_failure"}


class Stats:
    def __init__(self) -> None:
        self.n = 0; self.total = 0.0; self.square = 0.0; self.low = math.inf; self.high = -math.inf

    def add(self, value: float) -> None:
        if not math.isfinite(value): return
        self.n += 1; self.total += value; self.square += value * value
        self.low = min(self.low, value); self.high = max(self.high, value)

    def values(self) -> tuple[float | None, ...]:
        if not self.n: return (None, None, None, None)
        mean = self.total / self.n
        return (mean, math.sqrt(max(0.0, self.square / self.n - mean * mean)), self.low, self.high)


def _number(value: str) -> float | None:
    try: return float(value.strip())
    except (TypeError, ValueError): return None


def build_flight(path: Path, record: dict, feature_names: list[str]) -> tuple[list[dict], int | None]:
    columns: dict[str, list[str]] = {}
    windows: dict[int, dict[str, Stats]] = defaultdict(dict)
    onset = None
    healthy_seen = False
    with path.open(encoding="utf-8", errors="replace", newline="") as handle:
        # ArduPilot text exports can contain isolated NUL bytes after recovery;
        # discard those bytes without discarding the surrounding telemetry row.
        for row in csv.reader((line.replace("\x00", "") for line in handle), skipinitialspace=True):
            if not row: continue
            kind = row[0].strip()
            if kind == "FMT" and len(row) >= 6:
                columns[row[3].strip()] = [item.strip() for item in row[5:]]
                continue
            names = columns.get(kind)
            if not names or "TimeUS" not in names: continue
            values = {name: row[index + 1].strip() for index, name in enumerate(names) if index + 1 < len(row)}
            timestamp = _number(values.get("TimeUS", ""))
            if timestamp is None: continue
            timestamp_us = int(timestamp)
            fault = record["class"]
            health = None
            if fault == "gps_failure" and kind == "GPS" and values.get("I") == "0": health = (_number(values.get("Status", "")) or 0) >= 3
            elif fault == "accelerometer_failure" and kind == "IMU" and values.get("I") == "0": health = values.get("AH") == "1"
            elif fault == "gyroscope_failure" and kind == "IMU" and values.get("I") == "0": health = values.get("GH") == "1"
            elif fault == "compass_failure" and kind == "MAG" and values.get("I") == "0": health = values.get("Health") == "1"
            elif fault == "barometer_failure" and kind == "BARO" and values.get("I") == "0": health = values.get("Health") == "1"
            if health is True: healthy_seen = True
            elif health is False and healthy_seen and onset is None: onset = timestamp_us
            if kind not in SIGNALS: continue
            bucket = timestamp_us // WINDOW_US
            target = windows[bucket]
            for field in SIGNALS[kind]:
                value = _number(values.get(field, ""))
                if value is not None:
                    target.setdefault(f"{kind}.{field}", Stats()).add(value)
    output = []
    for bucket, stats in sorted(windows.items()):
        start_us = bucket * WINDOW_US
        label = "normal"
        eligible = record["class"] == "normal"
        if record["class"] == "rc_failure": label = "unknown"
        elif record["class"] in FAULTS:
            if onset is None or abs(start_us - onset) <= BOUNDARY_US: label = "unknown"
            elif start_us > onset: label = record["class"]; eligible = True
            else: eligible = True
        features = []
        for name in feature_names:
            signal, statistic = name.rsplit("_", 1)
            value = stats.get(signal)
            values = value.values() if value else (None, None, None, None)
            features.append(values[{"mean": 0, "std": 1, "min": 2, "max": 3}[statistic]])
        output.append({"flight_id": record["flight_id"], "group_id": record["group_id"],
                       "start_us": start_us, "label": label, "eligible": eligible and label != "unknown",
                       "features": features})
    return output, onset


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path); parser.add_argument("raw", type=Path); parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path); args = parser.parse_args()
    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    signals = [f"{kind}.{field}" for kind, fields in SIGNALS.items() for field in fields]
    feature_names = [f"{signal}_{stat}" for signal in signals for stat in ("mean", "std", "min", "max")]
    rows = []; onsets = {}; counts = defaultdict(int)
    for record in inventory["records"]:
        flight_rows, onset = build_flight(args.raw / f"{record['flight_id']}.log", record, feature_names)
        rows.extend(flight_rows); onsets[record["flight_id"]] = onset
        for row in flight_rows: counts[row["label"]] += 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for row in rows: handle.write(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n")
    report = {"schema_version": "1.0.0", "source_id": inventory["source_id"], "window_us": WINDOW_US,
              "boundary_us": BOUNDARY_US, "features": feature_names, "label_counts": dict(sorted(counts.items())),
              "onsets_us": onsets, "rc_failure_policy": "unknown/excluded: no unambiguous in-log onset",
              "location_group_count": len({item["group_id"] for item in inventory["records"]})}
    if args.report: args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"windows": len(rows), "labels": report["label_counts"], "features": len(feature_names)}, indent=2))
    return 0


if __name__ == "__main__": raise SystemExit(main())
