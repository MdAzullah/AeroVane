# AeroVane anomaly-model datasets

## UAV-FD real propulsion-fault corpus

The checksum-bound `uav-fd-zenodo-7648996` corpus contains 18 real hexarotor
flights from Zenodo record 7648996 under CC BY 4.0: six normal flights and
twelve chipped-propeller flights spanning six motors and two damage levels.
AeroVane reads only IMU, vibration, attitude, and ESC measurements. The fixed
split reserves motor 5 for validation and motor 6 for a one-time test. The
first candidate failed the recall gate and is not integrated; see
`experiments/UAVFD_PROPULSION_1_REPORT.md`. Its training script and the local
copy under `data/raw/uav-fd/` were removed on 2026-10-29; re-download from
Zenodo 7648996 and verify against `manifests/dataset_registry.json` if needed.

No approved real VTOL-hybrid fault corpus is currently available. Public PX4
VTOL logs without verified fault labels may support future normal/OOD studies,
but cannot be treated as supervised fault examples.

## Reviewed real-data corpus

The first controlled experiment uses the hash-scoped
`uav-sead-reviewed-v1` corpus documented in `docs/phase-reports/PHASE_C_COMPLETION_REPORT.md`.
It has frozen group-level train, validation, test, and excluded partitions.
Unknown/boundary windows are never supervised targets. The 12 privacy-safe
features are defined in `configs/window_features.json`; location, identifiers,
filenames, absolute timestamps, group IDs, and split IDs are not model inputs.

Experiment 2 acquired 20 additional flights in batches 031–034 for a fresh
test cohort. A pre-evaluation leakage check excluded five related flights whose
collection group overlapped the reviewed-v1 development corpus. The one-time
evaluation used the remaining 15 flights in 15 non-overlapping groups. These
fresh flights are evaluation evidence only and are not development data.

## Historical synthetic integration dataset

Retired on 2026-10-29: the generator script, the `aerovane-anomaly-1.0.0`
model and its unused `MlAnomalyDetector` were removed from the repository; the
record below is kept for history.

The Phase 9 training set was generated deterministically by
`train_anomaly_model.py` from seed `9341`. It contained 240 independent flights
with 20 five-second feature windows per flight. Flights—not individual
windows—are split 75/25 for training and holdout evaluation.

Labels cover normal flight, one strong simulated fault, and subtle multi-signal
anomalies below individual rule thresholds. The eight model inputs are battery
voltage, satellite count, peak vibration, attitude error, high-throttle descent,
maximum EKF variance, motor RPM deviation, and attitude update age.

Latitude and longitude are never included. No user-uploaded flight data is used
or transmitted. Real confirmed logs can be added later only after consent,
de-identification, and flight-level labeling.
