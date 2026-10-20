"""Generate a deterministic, synthetic ULog used only for parser integration tests."""

from __future__ import annotations

import struct
from pathlib import Path

HEADER = b"\x55\x4c\x6f\x67\x01\x12\x35" + b"\x01" + struct.pack("<Q", 0)


def _message(message_type: str, payload: bytes) -> bytes:
    return struct.pack("<HB", len(payload), ord(message_type)) + payload


def write_minimal_ulog(path: Path) -> None:
    """Write two battery samples using the public ULog F/A/D message layout."""
    format_payload = (
        b"battery_status:uint64_t timestamp;float voltage_v;float current_a;"
        b"float remaining;float temperature;"
    )
    add_logged_payload = struct.pack("<BH", 0, 1) + b"battery_status"
    rows = [
        struct.pack("<HQffff", 1, 1_000_000, 15.2, 2.5, 0.75, 31.0),
        struct.pack("<HQffff", 1, 2_000_000, 14.8, 3.0, 0.50, 32.0),
    ]
    payload = bytearray(HEADER)
    payload.extend(_message("F", format_payload))
    payload.extend(_message("A", add_logged_payload))
    for row in rows:
        payload.extend(_message("D", row))
    path.write_bytes(payload)


if __name__ == "__main__":
    write_minimal_ulog(Path(__file__).with_name("minimal_battery.ulg"))
