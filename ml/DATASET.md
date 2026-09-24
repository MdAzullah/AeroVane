# SkyForge anomaly-model dataset

The Phase 9 training set is generated deterministically by
`train_anomaly_model.py` from seed `9341`. It contains 240 independent flights
with 20 five-second feature windows per flight. Flights—not individual
windows—are split 75/25 for training and holdout evaluation.

Labels cover normal flight, one strong simulated fault, and subtle multi-signal
anomalies below individual rule thresholds. The eight model inputs are battery
voltage, satellite count, peak vibration, attitude error, high-throttle descent,
maximum EKF variance, motor RPM deviation, and attitude update age.

Latitude and longitude are never included. No user-uploaded flight data is used
or transmitted. Real confirmed logs can be added later only after consent,
de-identification, and flight-level labeling.
