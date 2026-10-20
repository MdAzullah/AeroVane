# Model evaluation

## BASiC simulated sensor classifier 1

The complete 70-log BASiC corpus was checksum-verified and split by its ten
simulated-location cohorts. A GPU-trained six-class MLP reached 81.41% accuracy
and 79.47% macro F1 on two untouched simulated locations, with 5.45%
low-confidence abstention. RC failure was excluded because its onset could not
be established unambiguously from the raw log.

This is simulation-only evidence and does not authorize real-flight component
diagnosis. A portable export is available in both viewers only as an explicit
experimental pattern advisory with coverage gating, persistence, and unknown
abstention. See
`experiments/BASIC_SIMULATED_SENSOR_CLASSIFIER_1_REPORT.md`.

## Professional candidate 1

A token-free local ensemble experiment compared Extra Trees and Random Forest
models with five-fold collection-group cross-validation. The selected
300-tree candidate failed the development gate: validation recall was 62.39%
and false-warning rate was 16.72%. It was rejected without opening a final
test cohort and was not promoted. See
`experiments/PROFESSIONAL_CANDIDATE_1_REPORT.md`.

## Second controlled real-data experiment

The 2026-09-28 nonlinear experiment passed its predefined fresh-test checks.
A depth-5 decision tree with a two-window persistence rule reached 80.90%
recall, 10.75% false-warning rate, and 74.23% F1 on 792 windows from 15 fresh,
non-overlapping flight groups. Five acquired flights were excluded before
scoring because their collection group overlapped development data.

This is experiment acceptance, not release approval. Per-flight/group macro
F1 was only 23.63%, performance varied substantially between flights, and the
cohort was small. The local model artifact remains Git-ignored and no viewer
integration was initially performed. A later controlled integration promoted
the portable artifact for live/TLog multicopters only, retaining deterministic
rules and failing closed for unvalidated routes. See
`experiments/UAV_SEAD_EXPERIMENT_2_REPORT.md` and the machine-readable report.

## Prospective advisory release gate

Release hardening now has a versioned policy in
`configs/model_release_gate.json` and an automated assessment in
`check_model_release.py`. The policy was created after Experiment 2, so it is
prospective and cannot turn that observed cohort into fresh release evidence.

Experiment 2 passes 7 of the gate's 15 checks. It does not meet the required
independent test-group, normal-flight, anomalous-flight, macro-F1,
window-false-warning, Brier-score, calibration-error, or external-evidence
checks. The next valid assessment requires a new hash/group-disjoint external
dataset or collection. Passing the automated checks would still require
warning-copy and human safety review.

## First controlled real-data experiment

The 2026-09-27 `uav-sead-reviewed-v1` logistic experiment was rejected. It
used train-only preprocessing, validation-only threshold selection, and one
evaluation of the frozen test groups. Test recall was 32.96% and the
false-warning rate was 21.30%, failing the predefined 50% and 15% release
limits. No model was exported. See
`experiments/UAV_SEAD_REVIEWED_V1_LOGISTIC_REPORT.md` and the machine-readable
experiment report.

The test split is now spent for this experiment family and must not be used to
tune a replacement.

## Historical synthetic integration prototype

Model: `skyforge-anomaly-1.0.0`

Deterministic flight-level holdout (1,200 windows):

| Method | Accuracy | False-warning rate | Missed-fault rate |
|---|---:|---:|---:|
| Browser anomaly model | 96.75% | 0.00% | 4.24% |
| Individual rules without temporal latches | 84.17% | 0.00% | 20.65% |

These are synthetic-simulation results, not real-world safety certification.
They demonstrate that the model recognizes the labeled subtle multi-signal
patterns better than individual thresholds on this dataset. Simulator and real
flight validation remain necessary before operational reliance.
