# Model evaluation

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
