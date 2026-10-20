# BASiC simulated sensor classifier 1

Date: 2026-09-29  
Decision: successful simulation experiment; not authorized for real-flight release

## Protocol

All 70 CC BY 4.0 BASiC ArduCopter SITL logs were downloaded from the official
Zenodo record and verified against the published byte sizes and MD5 checksums.
The ten published simulated-location cohorts were kept intact:

- locations 01–06: training;
- locations 07–08: validation and early stopping;
- locations 09–10: one final test evaluation.

Five-second windows contain 140 aggregate telemetry features. Absolute file
timestamps, source filenames, latitude, and longitude are excluded. Fault
windows begin only after an observed sensor health/status transition, with a
two-second unknown boundary. RC-failure flights are excluded because the raw
logs do not provide an unambiguous failure onset distinct from normal RTL.

The model is a small class-weighted 128/64-unit PyTorch MLP trained locally on
an NVIDIA RTX 3050. Low-confidence predictions below 0.65 produce an explicit
`unknown anomaly` abstention.

## Results

| Split | Locations | Windows | Accuracy | Macro F1 | Abstention |
| --- | ---: | ---: | ---: | ---: | ---: |
| Train | 6 | 2,836 | 99.51% | 99.51% | 0.21% |
| Validation | 2 | 844 | 88.03% | 85.91% | 2.96% |
| Test | 2 | 1,248 | 81.41% | 79.47% | 5.45% |

The untouched test set contains 661 normal, 30 GPS-failure, 152
accelerometer-failure, 172 gyroscope-failure, 118 compass-failure, and 115
barometer-failure windows. The largest observed confusions are between
accelerometer and gyroscope failures, and between compass/barometer failures
and normal behavior.

## Decision and limitations

The experiment demonstrates that location-held-out simulated sensor-fault
classification is feasible. It does **not** establish real-flight component
diagnosis or operational accuracy. Only two simulated locations were available
for final testing, pre-fault normal windows share flight context with their
post-fault counterparts, and the source contains no real hardware failures.

The `.pt` model remains a local ignored research artifact. A language-neutral
dense-network export is integrated into both viewers as a cautious,
simulation-trained pattern advisory. It runs alongside the generic anomaly
detector and deterministic rules, requires four observed telemetry families,
uses two-window persistence, and labels every warning as an unconfirmed
simulation-derived hypothesis. It cannot trigger vehicle actions. Confirmed
component diagnosis remains disabled until an independently labeled,
group-disjoint real-flight corpus passes a separately frozen gate.

The propulsion model remains unsupported because no suitable licensed,
confirmed motor/propeller corpus is available. The fixed-wing model remains
unsupported pending ALFA reuse approval and a separate fixed-wing pipeline.
