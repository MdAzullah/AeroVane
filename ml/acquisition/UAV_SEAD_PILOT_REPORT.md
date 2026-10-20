# UAV-SEAD pilot report

Date: 2026-09-25  
Source revision: `774a336a1d1d06b248927a35c2ea1f6869e9e1a4`  
Authorization: `ml/manifests/uav-sead-pilot-authorization.json`

## Outcome

The authorized five-flight pilot passed its acquisition, integrity, duplicate,
ULog parsing, canonical-schema, and privacy-minimization checks. This result
applies only to the five pinned pilot files; it does not approve the complete
dataset for training or evaluation.

## Results

| Local ID | Bytes | Canonical samples | Parse | Schema |
| --- | ---: | ---: | --- | --- |
| `flight-001.ulg` | 7,682,509 | 35,327 | pass | pass |
| `flight-002.ulg` | 4,715,969 | 23,738 | pass | pass |
| `flight-003.ulg` | 4,499,325 | 20,626 | pass | pass |
| `flight-004.ulg` | 12,162,878 | 61,593 | pass | pass |
| `flight-005.ulg` | 2,349,195 | 10,598 | pass | pass |
| **Total** | **31,409,876** | **151,882** | **5/5** | **5/5** |

- The payload used 5.9% of the authorized 512 MiB ceiling.
- All five SHA-256 hashes match the immutable-source object hashes returned by
  the host.
- The inventory found five unique hashes and zero duplicates.
- Location retention was disabled during canonical conversion.
- Upstream names are retained only in the Git-ignored local source map. The
  committed inventory contains neutral IDs, hashes, sizes, format, and source
  revision only.

## Artifacts

- Committed inventory: `ml/manifests/uav-sead-774a336a-pilot-inventory.json`
- Raw payloads: `data/raw/uav-sead/<revision>/payload/` (Git-ignored)
- Canonical output: `data/interim/uav-sead/<revision>/` (Git-ignored)

## Gate decision

The pilot evidence closes the sampled integrity, schema, and duplicate checks.
UAV-SEAD remains quarantined because five sampled files do not establish
whole-dataset admission, labeling fitness, leakage controls, or training
approval.
