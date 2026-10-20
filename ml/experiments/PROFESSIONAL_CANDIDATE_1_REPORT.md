# Professional candidate 1 development report

Date: 2026-09-29  
Decision: rejected at validation; never evaluated on a final test cohort

## Training protocol

Training ran locally using CPU estimators and no external AI/API service. It
does not consume model tokens. Four class-balanced Extra Trees and Random
Forest configurations were compared using five-fold collection-group
cross-validation on the frozen training partition. The existing validation
partition was used only for isotonic calibration and threshold selection.
No existing or fresh final-test rows were loaded or evaluated.

The selected development candidate was a 300-tree random forest with maximum
depth 8 and minimum leaf size 8.

## Validation result

| Metric | Result | Required |
| --- | ---: | ---: |
| Recall | 62.39% | at least 65% |
| False-warning rate | 16.72% | at most 15% |
| Precision | 55.51% | — |
| F1 | 58.75% | — |
| Missed-anomaly rate | 37.61% | — |

The candidate failed both release-driving validation requirements. It remains
a local Git-ignored artifact and must not replace the integrated Experiment 2
model.

## Data needed for the requested capability

The current source labels only normal versus anomalous intervals. They cannot
support reliable claims that a battery, motor, ESC, GPS, IMU, EKF, airframe, or
communications component is the actual cause. Professional subsystem
attribution requires independently confirmed fault-family labels, including
maintenance or inspection outcomes, across PX4 and ArduPilot vehicles.

Saved DataFlash model coverage also requires a separately reviewed ArduPilot
training and untouched test corpus. Until then, saved-log reports continue to
use deterministic evidence for component-specific findings, while the learned
model fails closed on that unvalidated route.
