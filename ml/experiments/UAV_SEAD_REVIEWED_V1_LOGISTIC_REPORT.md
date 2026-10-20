# Reviewed-v1 logistic experiment

Date: 2026-09-27  
Decision: rejected; no model exported

## Protocol

The experiment used only the checksum-authorized `uav-sead-reviewed-v1`
corpus. Unknown and excluded windows were omitted from supervised use.

- Train: 3,253 normal/anomalous windows from 87 groups
- Validation: 902 windows from 29 groups
- Test: 993 windows from 29 frozen groups
- Median imputation, means, and scales: fitted on train only
- Class-weighted logistic model: fitted on train only
- Threshold `0.49`: selected on validation only
- Frozen test evaluations: one

The predefined validation requirements were recall at least 60% and
false-warning rate at most 10%. Export also required test recall at least 50%,
test false-warning rate at most 15%, and F1 no worse than deterministic rules.

## Results

| Metric | Validation | Test | Rules on test |
| --- | ---: | ---: | ---: |
| Precision | 53.39% | 36.63% | 29.37% |
| Recall | 55.75% | 32.96% | 13.70% |
| F1 | 54.55% | 34.70% | 18.69% |
| False-warning rate | 16.27% | 21.30% | 12.31% |
| Missed-anomaly rate | 44.25% | 67.04% | 86.30% |
| Accuracy | 76.72% | 66.26% | 67.57% |

Test Brier score was `0.22086` and expected calibration error was `0.15182`.
Macro F1 across both test flights and test groups was `0.23377`. Every
anomalous test flight eventually had at least one warning, but window-level
coverage was poor; median first-warning delay was 2.5 seconds and maximum delay
was 142.5 seconds.

## Decision and next research step

Four of five acceptance checks failed. The model improved F1 over the simple
rules, but its false-warning and missed-anomaly rates are unsuitable for an
advisory release. No model artifact was exported and no application integration
was changed.

The frozen test set has now been observed and must not be reused to tune a
replacement. A later experiment needs a new protocol and newly frozen final
test groups. Candidate improvements should be selected using train and
validation evidence only—for example nonlinear interactions, flight-context
features, and probability calibration—before a new test set is opened.
