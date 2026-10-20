# Experiment 2: nonlinear fresh-cohort evaluation

Date: 2026-09-28  
Decision: experiment acceptance checks passed; application integration deferred

## Protocol and leakage repair

Logistic regression, decision-tree, and random-forest candidates were fitted
on the reviewed-v1 training partition and selected using only its validation
partition. The spent Experiment 1 test partition was not used for development.

Batches 031–034 initially contained 20 proposed fresh flights. A pre-evaluation
gate found that five flights shared collection group
`grp-6fa87fc1dba9be707e00` with development `flight-008`. All five related
flights were excluded before prediction or scoring. The evaluated cohort
therefore contains 15 flights in 15 independent groups, with no development
hash or group overlap.

The selected candidate was a class-balanced decision tree with maximum depth
5 and minimum leaf size 25, followed by a two-window persistence requirement.
It was refitted on train plus validation only after model selection. The fresh
cohort was evaluated once.

## Results

| Metric | Fresh test | Deterministic rules |
| --- | ---: | ---: |
| Precision | 68.57% | 7.83% |
| Recall | 80.90% | 9.55% |
| F1 | 74.23% | 8.61% |
| False-warning rate | 10.75% | 32.57% |
| Missed-anomaly rate | 19.10% | 90.45% |
| Accuracy | 87.37% | 54.42% |

All three predefined experiment checks passed: recall was at least 60%, the
false-warning rate was at most 15%, and F1 exceeded the rules baseline. All
seven anomalous flights received at least one warning. Median first-warning
delay was 0 seconds and maximum delay was 12.5 seconds.

## Limitations and release decision

The aggregate result is promising but uneven. Per-flight/group macro F1 was
23.63%; several anomalous flights had low recall, and false-warning rates were
high on some individual flights. The persisted output is binary rather than a
well-calibrated probability (Brier score and expected calibration error were
both 0.1263). The fresh cohort is also small.

The generated joblib file remains a local, Git-ignored research artifact. It
was not directly integrated into either viewer.
It can now be converted without reevaluating the test cohort into the versioned
portable decision-tree contract. Reference scoring matched the original
scikit-learn pipeline to floating-point precision; this establishes format
parity but does not by itself authorize deployment.

## Controlled project integration

On 2026-09-29 the accepted portable artifact was promoted into the live-viewer
analysis bundle with its experiment and checksum lineage intact. Runtime
aggregation matches the training contract: five-second windows, 2.5-second
stride, training-derived median imputation, and two consecutive anomalous
windows before an advisory warning. Deterministic detectors remain enabled.

The model is routed only to airborne multicopter telemetry from live/TLog
sources. Unknown families, fixed-wing vehicles, and saved DataFlash analysis
fail closed because cross-family and ArduPilot performance have not been
validated. This controlled integration is advisory-only and does not authorize
vehicle control, automatic remediation, or component-level diagnosis.
Serialization-contract and browser/runtime parity tests now exist, and a
prospective independent release gate has been added. The current evidence
passes only 7 of its 15 checks, so broader vehicle/firmware validation,
external group-disjoint evidence, calibration improvement, and explicit
warning UX review remain required. The model remains advisory-only.
