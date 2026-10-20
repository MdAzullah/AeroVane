# Public UAV fault-data source review

Reviewed: 2026-09-29

## Admitted for controlled acquisition

### BASiC — Zenodo 8199999

Official CC BY 4.0 record with 70 ArduPilot SITL flights and upstream MD5s.
It covers normal flight plus injected GPS, RC, accelerometer, gyroscope,
compass, and barometer failures. The five-file parser/label pilot is acquired;
training remains prohibited until the full grouping and onset evidence is
validated. Simulation data cannot independently establish real-aircraft
performance.

### ALFA — DOI 10.1184/R1/12707963

CMU AirLab publishes 47 processed real fixed-wing flights with exact fault type
and time for engine, rudder, aileron, and elevator faults, plus raw MAVLink,
DataFlash, and telemetry material. It is a strong fixed-wing evaluation source,
but license terms and archive checksums must be captured from the official
repository metadata before acquisition.

## Quarantined or supplemental only

- UT Drone PHM: useful propeller-condition archives, but the GitHub repository
  has only a README license badge and Google Drive links without published
  archive checksums or sufficient collection-group documentation. Do not train.
- IDF_DS: 240 fixed-wing flights useful for normal-behaviour coverage, but it
  does not provide confirmed component-fault labels. Supplemental normal data
  only after license and grouping review.
- DroneLog and Flight Review collections: useful tooling or weak diagnostics,
  not independently confirmed fault ground truth. Rule/diagnostic outputs must
  not be promoted to supervised fault labels.

## Accuracy target

`99% confidence` is not a training setting. The release protocol may target a
99% confidence interval or 99% accuracy, but must also require per-class recall,
false-warning rate, calibration, group-level performance, and independent
real-flight testing. No model is promoted merely because aggregate accuracy is
high on imbalanced or simulated data.
