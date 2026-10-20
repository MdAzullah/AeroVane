# UAV-SEAD Batch 001 acquisition report

Date: 2026-09-26  
Revision: `774a336a1d1d06b248927a35c2ea1f6869e9e1a4`  
Authorization: `ml/manifests/uav-sead-batch-001-authorization.json`

## Outcome

The checksum-bound Batch 001 authorization validated before download. Exactly
five proposed files were acquired under neutral names. The result used the
authorized 36,089,238-byte ceiling exactly and did not perform a bulk fetch.

| Candidate | Bytes | Canonical samples | Parse | Schema |
| --- | ---: | ---: | --- | --- |
| `candidate-001` | 11,649,174 | 77,590 | pass | pass |
| `candidate-002` | 19,038,178 | 74,738 | pass | pass |
| `candidate-003` | 4,904,938 | 35,521 | pass | pass |
| `candidate-004` | 243,413 | 700 | pass | pass |
| `candidate-005` | 253,535 | 840 | pass | pass |
| **Total** | **36,089,238** | **189,389** | **5/5** | **5/5** |

The inventory contains five unique SHA-256 hashes and zero duplicates. The raw
files, canonical outputs, download receipt, exact source mapping, and grouping
key remain Git-ignored. Location retention was disabled.

## Safety boundary

This batch is authorized only for local acquisition, parsing, labeling, and
feature-quality checks. It remains excluded from training and evaluation.
The pinned annotations were converted to neutral IDs `flight-006` through
`flight-010`. All ranges satisfy `flight_start <= range_start < range_end <=
flight_end`; source notes, annotation timestamps, and filenames were omitted.

Three flights contain explicitly ranged expert anomalies and two are confirmed
normal. Deterministic preprocessing produced 311 excluded windows: 103
anomalous, 189 normal, and 19 unknown boundary windows. Required feature
coverage ranged from 99.36% to 100%. No imputation, normalization, evaluation,
or model fitting occurred.
