#!/usr/bin/env python3
"""Dependency-free semantic validation for canonical telemetry JSON/JSONL."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Mapping

SOURCES = {"live", "tlog", "dataflash", "simulation", "ulog"}
FLIGHT_PHASES = {"unknown", "disconnected", "on_ground", "armed", "flying", "landing", "landed"}
VEHICLE_FAMILIES = {
    "multicopter", "fixed_wing", "vtol_hybrid", "ground_rover",
    "surface_vessel", "submersible", "lighter_than_air_other", "unknown",
}
QUALITY_FLAGS = {
    "missing_or_invalid", "source_reported_unavailable", "out_of_range",
    "stale", "estimated",
}


def validate_sample(sample: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    if sample.get("schemaVersion") != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    timestamp = sample.get("timestampMs")
    if not _finite_number(timestamp) or timestamp < 0:
        errors.append("timestampMs must be a finite non-negative number")
    if sample.get("source") not in SOURCES:
        errors.append("source is unsupported")
    if "flightPhase" in sample and sample["flightPhase"] not in FLIGHT_PHASES:
        errors.append("flightPhase is unsupported")

    values = _mapping(sample.get("values"), "values", errors)
    units = _mapping(sample.get("units", {}), "units", errors)
    text_values = _mapping(sample.get("textValues", {}), "textValues", errors)
    availability = _mapping(sample.get("availability"), "availability", errors)
    flags = _mapping(sample.get("qualityFlags", {}), "qualityFlags", errors)

    for signal, value in values.items():
        if not signal or not _finite_number(value):
            errors.append(f"{signal or '<empty>'}: value must be finite")
        if availability.get(signal) is not True:
            errors.append(f"{signal}: numeric value must be marked available")
        if not isinstance(units.get(signal), str) or not units[signal]:
            errors.append(f"{signal}: available numeric value requires a unit")

    for signal, available in availability.items():
        if not signal or type(available) is not bool:
            errors.append(f"{signal or '<empty>'}: availability must be boolean")
        elif available and signal not in values and signal not in text_values:
            errors.append(f"{signal}: marked available without a value")
        elif not available and signal in values:
            errors.append(f"{signal}: unavailable signal must be absent from values")

    for signal, signal_flags in flags.items():
        if not isinstance(signal_flags, list) or not signal_flags:
            errors.append(f"{signal}: quality flags must be a non-empty list")
            continue
        unknown = set(signal_flags) - QUALITY_FLAGS
        if unknown:
            errors.append(f"{signal}: unsupported quality flags {sorted(unknown)}")
        if len(signal_flags) != len(set(signal_flags)):
            errors.append(f"{signal}: duplicate quality flags")
    for signal, available in availability.items():
        if available is False and signal not in flags:
            errors.append(f"{signal}: unavailable signal requires a quality flag")

    vehicle = sample.get("vehicle")
    if vehicle is not None:
        if not isinstance(vehicle, Mapping):
            errors.append("vehicle must be an object")
        else:
            if vehicle.get("family") not in VEHICLE_FAMILIES:
                errors.append("vehicle.family is unsupported")
            for field in ("systemId", "componentId", "mavType", "autopilot"):
                value = vehicle.get(field)
                if type(value) is not int or not 0 <= value <= 255:
                    errors.append(f"vehicle.{field} must be an integer from 0 to 255")
    frame = sample.get("frame")
    if frame is not None:
        if not isinstance(frame, Mapping) or not frame:
            errors.append("frame must be a non-empty object")
        else:
            allowed_frame_fields = {
                "airframeId", "allocatorAirframe", "frameClass", "frameType",
                "vtolFrameClass", "vtolFrameType",
            }
            for field, value in frame.items():
                if field not in allowed_frame_fields:
                    errors.append(f"frame.{field} is unsupported")
                elif not _finite_number(value) or value < 0:
                    errors.append(f"frame.{field} must be a finite non-negative number")
    return errors


def _mapping(value: Any, name: str, errors: list[str]) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        errors.append(f"{name} must be an object")
        return {}
    return value


def _finite_number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def validate_jsonl(path: Path) -> list[str]:
    errors: list[str] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                sample = json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
            except (json.JSONDecodeError, ValueError) as error:
                errors.append(f"line {line_number}: invalid JSON: {error}")
                continue
            if not isinstance(sample, Mapping):
                errors.append(f"line {line_number}: sample must be an object")
                continue
            errors.extend(f"line {line_number}: {error}" for error in validate_sample(sample))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Canonical JSONL file")
    args = parser.parse_args()
    errors = validate_jsonl(args.input)
    if errors:
        print("Canonical telemetry validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Canonical telemetry valid: {args.input}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
