# UAV-SEAD Batch 003 acquisition report

Date: 2026-09-27  
Revision: `774a336a1d1d06b248927a35c2ea1f6869e9e1a4`  
Authorization: `ml/manifests/uav-sead-batch-003-authorization.json`

## Outcome

The reviewed proposal excluded all 15 prior locators and selected five files
from five previously unused opaque groups. Its checksum-bound authorization
passed before downloading exactly five files and 51,248,676 bytes.

The inventory contains five unique hashes, with no overlap against the prior
15-flight corpus. All files parsed successfully with location disabled and all
237,020 canonical samples passed semantic validation.

| Candidate | Neutral flight | Bytes | Canonical samples | Result |
| --- | --- | ---: | ---: | --- |
| `candidate-001` | `flight-016` | 12,083,801 | 82,052 | excluded as unknown |
| `candidate-002` | `flight-017` | 14,723,066 | 59,147 | ranged anomaly |
| `candidate-003` | `flight-018` | 23,850,016 | 94,035 | ranged anomaly |
| `candidate-004` | `flight-019` | 284,487 | 841 | normal |
| `candidate-005` | `flight-020` | 307,306 | 945 | normal |

## Data-quality finding

`flight-016` could not retain its proposed anomalous label. One source interval
ends at 351,481.0 ms while parsed telemetry ends at 351,412.272 ms, an excess
of 68.728 ms. The pipeline did not clamp, truncate, or infer a replacement
interval. It marked the entire flight `unknown`, set `training_eligible` to
false, discarded the invalid ranges from window labeling, and recorded the
exact reason in the label manifest.

The remaining two anomaly flights passed full interval containment checks, and
the two normal flights passed label conversion.

## Preprocessing and safety boundary

All five groups are frozen in `excluded` and `training_authorized` is false.
The batch produced 347 windows: 39 anomalous, 193 normal, and 115 unknown.
Of the unknown windows, 108 belong to the rejected flight and seven are anomaly
boundary windows. Feature coverage is 99.7118–100%, location and identifier
features remain absent, and `model_fitted` is false.

No training, evaluation, normalization, imputation, or threshold fitting was
performed.
