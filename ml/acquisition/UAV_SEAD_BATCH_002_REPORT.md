# UAV-SEAD Batch 002 acquisition report

Date: 2026-09-27  
Revision: `774a336a1d1d06b248927a35c2ea1f6869e9e1a4`  
Authorization: `ml/manifests/uav-sead-batch-002-authorization.json`

## Outcome

The proposal excluded all 10 prior source locators and preferred collection
groups not used by the pilot or Batch 001. It selected three explicitly ranged
anomaly flights and two normal flights from five new opaque groups. The
checksum-bound authorization validated before download.

Exactly five files and 26,005,952 bytes were acquired. The inventory contains
five unique SHA-256 hashes and zero duplicates.

| Candidate | Bytes | Canonical samples | Parse | Schema |
| --- | ---: | ---: | --- | --- |
| `candidate-001` | 7,349,042 | 29,350 | pass | pass |
| `candidate-002` | 6,462,923 | 44,614 | pass | pass |
| `candidate-003` | 11,678,205 | 78,162 | pass | pass |
| `candidate-004` | 254,249 | 742 | pass | pass |
| `candidate-005` | 261,533 | 770 | pass | pass |
| **Total** | **26,005,952** | **153,638** | **5/5** | **5/5** |

Location retention was disabled. The raw files, canonical outputs, download
receipt, exact source mapping, and grouping key remain Git-ignored.

## Labels and preprocessing

The pinned annotations became neutral IDs `flight-011` through `flight-015`.
Every anomaly interval is fully inside its parsed flight duration. Three
flights are anomalous and two are normal; no flight has an unknown flight-level
label.

All five groups remain in `excluded`, `training_authorized` is false, and the
source remains quarantined. Deterministic preprocessing produced 277 excluded
windows: 107 anomalous, 158 normal, and 12 unknown boundary windows. All 12
features have 100% window coverage and `model_fitted` is false.

No training, evaluation, normalization, imputation, or threshold fitting was
performed.
