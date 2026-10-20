# UAV-FD propulsion candidate 1

Date: 2026-10-05  
Decision: rejected; not integrated

The candidate used all 18 checksum-verified real hexarotor flights from UAV-FD
(Zenodo 7648996, CC BY 4.0). Motors 1–4 and matching normal flights were used
for training, motor 5 for model selection, and motor 6 plus its matching normal
flight as the one-time untouched test condition. No location or identity field
was used.

The selected depth-7 decision tree achieved 98.59% precision, 73.68% recall,
84.34% F1, and a 2.33% false-warning rate after the same two-window
persistence intended for runtime. It failed the frozen 80% minimum recall, so
the portable artifact was not copied into either viewer and deterministic
propulsion detectors remain primary.

Raw single-window recall was 83.16%, but its 16.28% false-warning rate was too
high. This demonstrates the tradeoff rather than authorizing a different
threshold after viewing test results. Further development needs new untouched
aircraft/propeller groups; this test condition must not be reused as fresh
evidence.

The dataset covers chipped propellers on one multicopter platform. It does not
validate motors, ESCs, other propulsion failures, or VTOL aircraft.
