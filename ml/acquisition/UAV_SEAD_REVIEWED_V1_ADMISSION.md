# UAV-SEAD reviewed corpus v1 admission

Decision date: 2026-09-27

This approval applies only to the 155 acquired payload hashes in cumulative
inventory SHA-256
`b31c3513415e85b4601cc33db5867bcf8121ba22d1f25e96c8c5dee2f75e007f`.
It does not approve the unacquired remainder of upstream UAV-SEAD.

All 155 files are tied to immutable upstream revision
`774a336a1d1d06b248927a35c2ea1f6869e9e1a4`. Per-batch authorizations and
receipts match declared counts and sizes. The cumulative inventory has 155
unique SHA-256 hashes and no duplicates. Every file parsed with the pinned
ULog adapter and every canonical record passed semantic validation with
latitude/longitude disabled. Original filenames, source paths, notes, device
IDs, coordinates, and absolute timestamps are absent from committed model
features.

Pinned expert annotations were range-checked against parsed durations. Six
flights with unknown or invalid annotations remain ineligible. Any privacy-safe
group containing such a flight is excluded as a whole. No fault-family cause
is inferred from the source classes.

The approved uses are limited to parser testing and controlled binary
normal-versus-anomalous training/evaluation under the frozen group split.
This admission does not itself authorize training; the split, readiness gate,
and separate training authorization must still pass.
