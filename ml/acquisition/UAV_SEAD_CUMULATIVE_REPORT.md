# UAV-SEAD cumulative corpus report

Updated: 2026-09-27  
Source revision: `774a336a1d1d06b248927a35c2ea1f6869e9e1a4`  
Scope: original pilot and Batches 001–003

## Result

The four reviewed cohorts were combined without changing any SHA-256 digest,
neutral flight ID, opaque group ID, label, anomaly interval, eligibility flag,
or exclusion assignment. The cumulative corpus contains 20 ULogs totaling
144,753,742 bytes. All 20 hashes are unique.

Every flight remains in the `excluded` partition and the frozen cumulative
split manifest has `training_authorized: false`. The source remains
quarantined. No training, normalization, imputation, threshold selection, or
model evaluation was performed.

## Leakage and lineage checks

- Inventory, label, group, and split hash sets match exactly.
- All 20 SHA-256 values and all 20 neutral flight IDs are unique.
- The corpus contains 16 privacy-safe collection groups: the conservative
  five-flight pilot cohort and 15 opaque groups from Batches 001–003.
- No group crosses a partition; all 16 groups occur only in `excluded`.
- Both unknown-label flights remain excluded, including Batch 003's rejected
  out-of-bounds source annotation.
- Cumulative preprocessing evidence reports `model_fitted: false`.

The cumulative builder rejects duplicate hashes or flight IDs, mismatched hash
sets, changed source identity, active split assignments, training-authorized
inputs, fitted preprocessing, feature-set drift, and inconsistent preprocessing
or privacy settings.

## Cumulative feature evidence

- Windows: 1,061 total — 652 normal, 252 anomalous, and 157 unknown.
- Flights contributing supervised-label windows: 18 — nine normal-only and
  nine anomalous.
- Required feature coverage: 99.8115% to 100%, computed by weighting each
  cohort's coverage by its window count.
- Split windows: 1,061 excluded; zero train, validation, or test windows.

## Readiness gate

The cumulative corpus passes 3 of 17 checks and is not ready for a controlled
experiment.

| Check | Actual | Required | Shortfall |
| --- | ---: | ---: | ---: |
| Independent groups | 16 | 60 | 44 |
| Eligible flights | 18 | 120 | 102 |
| Normal-only flights | 9 | 60 | 51 |
| Anomalous flights | 9 | 40 | 31 |
| Normal windows | 652 | 3,000 | 2,348 |
| Anomalous windows | 252 | 1,000 | 748 |
| Lowest feature coverage | 99.8115% | 95% | 0 |
| Training groups | 0 | 36 | 36 |
| Validation groups | 0 | 12 | 12 |
| Test groups | 0 | 12 | 12 |

The other failing checks are intentional safety gates: the registry decision is
still `quarantined`, training is not authorized, and the three active
partitions have no label coverage because all data is excluded. The passing
checks are feature coverage, frozen split status, and confirmation that
preprocessing did not fit a model.

## Reproduction

```bash
python3 ml/acquisition/build_cumulative_manifests.py \
  ml/manifests/uav-sead-774a336a-cumulative \
  ml/manifests/uav-sead-774a336a-pilot \
  ml/manifests/uav-sead-774a336a-batch-001 \
  ml/manifests/uav-sead-774a336a-batch-002 \
  ml/manifests/uav-sead-774a336a-batch-003 \
  --created-at 2026-09-27T01:30:00Z

python3 ml/acquisition/validate_splits.py \
  ml/manifests/uav-sead-774a336a-cumulative-groups.json \
  ml/manifests/uav-sead-774a336a-cumulative-splits.json \
  ml/manifests/uav-sead-774a336a-cumulative-inventory.json \
  ml/manifests/uav-sead-774a336a-cumulative-labels.json \
  ml/manifests/dataset_registry.json

python3 ml/acquisition/check_corpus_readiness.py \
  ml/configs/corpus_admission.json \
  ml/manifests/uav-sead-774a336a-cumulative-feature-quality.json \
  ml/manifests/uav-sead-774a336a-cumulative-groups.json \
  ml/manifests/uav-sead-774a336a-cumulative-splits.json \
  ml/manifests/dataset_registry.json \
  --output ml/manifests/uav-sead-774a336a-cumulative-readiness.json
```

The next task is to generate and review a neutral Batch 004 proposal that
excludes all 20 source locators already represented here and prefers unused
collection groups. A checksum-bound authorization is still required before any
download.
