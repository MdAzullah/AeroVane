#!/usr/bin/env python3
"""Convert PX4 ULog topics to the SkyForge canonical JSONL contract."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping, Protocol, Sequence

SCHEMA_VERSION = "1.0.0"
MAV_AUTOPILOT_PX4 = 12


class Dataset(Protocol):
    name: str
    multi_id: int
    data: Mapping[str, Sequence[Any]]


VEHICLE_FAMILIES = {
    1: "fixed_wing",
    2: "multicopter", 3: "multicopter", 4: "multicopter",
    7: "lighter_than_air_other", 8: "lighter_than_air_other",
    10: "ground_rover", 11: "surface_vessel", 12: "submersible",
    13: "multicopter", 14: "multicopter", 15: "multicopter",
    16: "lighter_than_air_other", 17: "lighter_than_air_other",
    19: "vtol_hybrid", 20: "vtol_hybrid", 21: "vtol_hybrid",
    22: "vtol_hybrid", 23: "vtol_hybrid", 24: "vtol_hybrid", 25: "vtol_hybrid",
    28: "lighter_than_air_other", 29: "multicopter", 35: "multicopter",
}

TOPIC_SIGNALS: dict[str, dict[str, tuple[str, str, float]]] = {
    "battery_status": {
        "voltage_v": ("battery.voltage_v", "V", 1.0),
        "current_a": ("battery.current_a", "A", 1.0),
        "remaining": ("battery.remaining_pct", "%", 100.0),
        "temperature": ("battery.temperature_c", "°C", 1.0),
    },
    "vehicle_gps_position": {
        "fix_type": ("gps.fix_type", "enum", 1.0),
        "satellites_used": ("gps.satellites", "count", 1.0),
        "lat": ("gps.latitude_deg", "deg", 1e-7),
        "lon": ("gps.longitude_deg", "deg", 1e-7),
        "alt": ("gps.altitude_m", "m", 0.001),
        "vel_m_s": ("gps.ground_speed_mps", "m/s", 1.0),
    },
    "vehicle_global_position": {
        "lat": ("position.latitude_deg", "deg", 1.0),
        "lon": ("position.longitude_deg", "deg", 1.0),
        "alt": ("position.altitude_m", "m", 1.0),
    },
    "vehicle_local_position": {
        "x": ("position.north_m", "m", 1.0),
        "y": ("position.east_m", "m", 1.0),
        "z": ("position.down_m", "m", 1.0),
        "vx": ("velocity.north_mps", "m/s", 1.0),
        "vy": ("velocity.east_mps", "m/s", 1.0),
        "vz": ("velocity.down_mps", "m/s", 1.0),
    },
    "vehicle_status": {
        "arming_state": ("flight.arming_state", "enum", 1.0),
        "nav_state": ("flight.nav_state", "enum", 1.0),
        "vehicle_type": ("vehicle.px4_type", "enum", 1.0),
        "failsafe": ("flight.failsafe", "boolean", 1.0),
    },
    "vehicle_land_detected": {
        "landed": ("flight.landed", "boolean", 1.0),
        "ground_contact": ("flight.ground_contact", "boolean", 1.0),
        "maybe_landed": ("flight.maybe_landed", "boolean", 1.0),
    },
    "vehicle_attitude": {},
    "estimator_status": {
        "filter_fault_flags": ("ekf.filter_fault_flags", "bitmask", 1.0),
        "gps_check_fail_flags": ("ekf.gps_check_fail_flags", "bitmask", 1.0),
        "vel_test_ratio": ("ekf.velocity_test_ratio", "ratio", 1.0),
        "pos_test_ratio": ("ekf.position_test_ratio", "ratio", 1.0),
        "hgt_test_ratio": ("ekf.height_test_ratio", "ratio", 1.0),
        "mag_test_ratio": ("ekf.magnetometer_test_ratio", "ratio", 1.0),
    },
    "sensor_combined": {
        "accelerometer_m_s2[0]": ("imu.xacc_mps2", "m/s²", 1.0),
        "accelerometer_m_s2[1]": ("imu.yacc_mps2", "m/s²", 1.0),
        "accelerometer_m_s2[2]": ("imu.zacc_mps2", "m/s²", 1.0),
        "gyro_rad[0]": ("imu.xgyro_radps", "rad/s", 1.0),
        "gyro_rad[1]": ("imu.ygyro_radps", "rad/s", 1.0),
        "gyro_rad[2]": ("imu.zgyro_radps", "rad/s", 1.0),
    },
}

LOCATION_SIGNALS = {
    "gps.latitude_deg", "gps.longitude_deg",
    "position.latitude_deg", "position.longitude_deg",
}


def route_mav_type(mav_type: int) -> str:
    return VEHICLE_FAMILIES.get(mav_type, "unknown")


def _finite(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _value_at(data: Mapping[str, Sequence[Any]], field: str, index: int) -> Any:
    series = data.get(field)
    if series is None or index >= len(series):
        return None
    return series[index]


def normalize_datasets(
    datasets: Iterable[Dataset],
    initial_parameters: Mapping[str, Any] | None = None,
    *,
    include_location: bool = False,
) -> list[dict[str, Any]]:
    """Normalize already-decoded pyulog datasets; useful for tests and ingestion."""
    parameters = initial_parameters or {}
    mav_type_value = _finite(parameters.get("MAV_TYPE"))
    mav_type = int(mav_type_value) if mav_type_value is not None else 0
    system_id_value = _finite(parameters.get("MAV_SYS_ID"))
    system_id = int(system_id_value) if system_id_value is not None else 1
    vehicle = {
        "systemId": max(0, min(255, system_id)),
        "componentId": 1,
        "mavType": max(0, min(255, mav_type)),
        "autopilot": MAV_AUTOPILOT_PX4,
        "family": route_mav_type(mav_type),
    }
    frame = _frame_metadata(parameters)
    samples: list[tuple[float, int, dict[str, Any]]] = []
    sequence = 0

    for dataset in datasets:
        field_map = TOPIC_SIGNALS.get(dataset.name)
        timestamps = dataset.data.get("timestamp")
        if field_map is None or timestamps is None:
            continue
        for index, raw_timestamp in enumerate(timestamps):
            timestamp_us = _finite(raw_timestamp)
            if timestamp_us is None or timestamp_us < 0:
                continue
            values: dict[str, float] = {}
            units: dict[str, str] = {}
            availability: dict[str, bool] = {}
            quality_flags: dict[str, list[str]] = {}
            for field, (signal, unit, scale) in field_map.items():
                if not include_location and signal in LOCATION_SIGNALS:
                    continue
                value = _finite(_value_at(dataset.data, field, index))
                available = value is not None
                availability[signal] = available
                if available:
                    values[signal] = value * scale
                    units[signal] = unit
                else:
                    quality_flags[signal] = ["missing_or_invalid"]
            if dataset.name == "vehicle_attitude":
                _add_attitude(dataset.data, index, values, units, availability, quality_flags)
            sample: dict[str, Any] = {
                "schemaVersion": SCHEMA_VERSION,
                "timestampMs": timestamp_us / 1000.0,
                "source": "ulog",
                "vehicleId": f"{vehicle['systemId']}:1",
                "vehicle": vehicle.copy(),
                **({"frame": frame.copy()} if frame else {}),
                "flightPhase": "unknown",
                "values": values,
                "units": units,
                "availability": availability,
            }
            if quality_flags:
                sample["qualityFlags"] = quality_flags
            samples.append((timestamp_us, sequence, sample))
            sequence += 1

    samples.sort(key=lambda item: (item[0], item[1]))
    ordered = [sample for _, _, sample in samples]
    _infer_flight_phases(ordered)
    return ordered


def _frame_metadata(parameters: Mapping[str, Any]) -> dict[str, float | int]:
    mapping = {
        "SYS_AUTOSTART": "airframeId",
        "CA_AIRFRAME": "allocatorAirframe",
    }
    frame: dict[str, float | int] = {}
    for parameter, field in mapping.items():
        value = _finite(parameters.get(parameter))
        if value is not None and value >= 0:
            frame[field] = int(value) if value.is_integer() else value
    return frame


def _add_attitude(
    data: Mapping[str, Sequence[Any]],
    index: int,
    values: dict[str, float],
    units: dict[str, str],
    availability: dict[str, bool],
    quality_flags: dict[str, list[str]],
) -> None:
    signals = ("attitude.roll_rad", "attitude.pitch_rad", "attitude.yaw_rad")
    quaternion = [_finite(_value_at(data, f"q[{axis}]", index)) for axis in range(4)]
    if any(value is None for value in quaternion):
        for signal in signals:
            availability[signal] = False
            quality_flags[signal] = ["missing_or_invalid"]
        return
    w, x, y, z = (float(value) for value in quaternion)
    norm = math.sqrt(w * w + x * x + y * y + z * z)
    if norm < 0.5:
        for signal in signals:
            availability[signal] = False
            quality_flags[signal] = ["out_of_range"]
        return
    w, x, y, z = w / norm, x / norm, y / norm, z / norm
    converted = {
        "attitude.roll_rad": math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
        "attitude.pitch_rad": math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x)))),
        "attitude.yaw_rad": math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
    }
    for signal, value in converted.items():
        values[signal] = value
        units[signal] = "rad"
        availability[signal] = True


def _infer_flight_phases(samples: list[dict[str, Any]]) -> None:
    armed = False
    landed: bool | None = None
    has_flown = False
    for sample in samples:
        values = sample["values"]
        if "flight.arming_state" in values:
            armed = int(values["flight.arming_state"]) == 2
        if "flight.landed" in values:
            landed = bool(values["flight.landed"])
            if not landed:
                has_flown = True
        if landed is False:
            phase = "flying"
        elif landed is True and has_flown:
            phase = "landed"
        elif armed:
            phase = "armed"
        elif landed is True:
            phase = "on_ground"
        else:
            phase = "unknown"
        sample["flightPhase"] = phase


def parse_ulog(path: Path, *, include_location: bool = False) -> list[dict[str, Any]]:
    try:
        from pyulog import ULog
    except ImportError as error:
        raise RuntimeError("PX4 ULog ingestion requires: python3 -m pip install -r ml/requirements.txt") from error

    ulog = ULog(str(path), list(TOPIC_SIGNALS))
    if getattr(ulog, "file_corruption", False):
        raise ValueError(f"ULog parser reported corruption: {path}")
    return normalize_datasets(
        ulog.data_list,
        getattr(ulog, "initial_parameters", {}),
        include_location=include_location,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="PX4 .ulg file")
    parser.add_argument("output", type=Path, help="Canonical JSONL output")
    parser.add_argument("--include-location", action="store_true", help="Retain latitude/longitude (off by default for privacy)")
    args = parser.parse_args()
    if args.input.suffix.lower() != ".ulg":
        parser.error("input must have a .ulg extension")
    samples = parse_ulog(args.input, include_location=args.include_location)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for sample in samples:
            handle.write(json.dumps(sample, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"Wrote {len(samples)} canonical samples to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
