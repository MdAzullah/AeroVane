# Telemetry source compatibility

Version: 1.0.0  
Reviewed: 2026-09-25

This matrix freezes the Phase B fields currently admitted to the canonical
contract. A firmware adding, removing, renaming, or changing the unit of a
field requires an adapter test before the new variant is accepted.

## MAVLink live and `.tlog`

Both sources use the bundled MAVLink dialect and the same normalizer. Supported
messages include HEARTBEAT, AUTOPILOT_VERSION, SYS_STATUS, BATTERY_STATUS,
GPS_RAW_INT, GLOBAL_POSITION_INT, ATTITUDE, ATTITUDE_TARGET, VFR_HUD,
VIBRATION, EKF_STATUS_REPORT, EXTENDED_SYS_STATE, HIGHRES_IMU, ESC_STATUS,
ESC_INFO, and STATUSTEXT.

Unavailable protocol sentinels are omitted, including `UINT16_MAX` battery/GPS
fields, `-1` current/remaining fields, `UINT32_MAX` clipping counters, and the
ESC temperature sentinel. MAVLink 2 truncated extension fields remain missing;
they are not converted to measurements merely because the decoder pads bytes.

## ArduPilot DataFlash

Supported message aliases:

| Canonical area | DataFlash variants/fields |
|---|---|
| Battery | `BAT`/`CURR`: `Volt` or `Voltage`, `Curr` or `Current`, `Temp` |
| GPS | `GPS`/`GPS2`: `Status`, `NSats` or `Sats`, `HDop`, `Alt`, `VZ`, `Spd` |
| Attitude | `ATT`: `Roll`, `Pitch`, `DesRoll`/`RollDes`, `DesPitch`/`PitchDes` |
| Vibration | `VIBE`: `VibeX/Y/Z`, `Clip0/1/2` or `Clip` |
| Control | `CTUN`: `ThO`/`ThrOut`, `CRt`/`ClimbRate` |
| EKF | `XKF4`/`NKF4`/`EKF`: `SV`/`VelVar`, `SP`/`PosVar`, `SH`/`HgtVar`, `SM`/`MagVar`, `FS`/`Flags` |
| Frame | `PARM`: `FRAME_CLASS`, `FRAME_TYPE`, `Q_FRAME_CLASS`, `Q_FRAME_TYPE` |

The adapter preserves the source values and only applies explicitly tested unit
conversions. Unknown messages produce empty samples rather than fabricated
measurements. New DataFlash message revisions require fixture coverage.

## PX4 ULog

Supported topics are `battery_status`, `vehicle_gps_position`,
`vehicle_global_position`, `vehicle_local_position`, `vehicle_status`,
`vehicle_land_detected`, `vehicle_attitude`, `estimator_status`, and
`sensor_combined`.

- ULog timestamps are monotonic microseconds and become milliseconds.
- `vehicle_attitude.q[0..3]` is normalized before Euler conversion.
- GPS integer latitude/longitude uses `1e-7` degrees; GPS altitude uses
  millimetres. Global-position fields are already degrees/metres.
- `battery_status.remaining` is a 0–1 fraction and becomes percent.
- `SYS_AUTOSTART` and `CA_AIRFRAME` are retained as raw frame identifiers.
- Latitude/longitude is excluded by default.

Older or newer PX4 releases may omit fields. Missing columns remain unavailable
with quality flags. Topic renames and semantic unit changes are unsupported
until a comparison fixture proves the mapping.

## Compatibility policy

Parsing success is not evidence that every field is semantically compatible.
Every added variant must include source field names, units, scaling, sentinel
behavior, and a deterministic expected-output fixture. Unknown vehicle types,
frames, topics, or messages fail closed to available rules and do not gain an
ML support claim.
