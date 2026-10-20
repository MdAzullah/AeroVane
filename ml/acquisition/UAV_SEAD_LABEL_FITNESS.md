# UAV-SEAD label-fitness and leakage review

Reviewed: 2026-09-25  
Revision: `774a336a1d1d06b248927a35c2ea1f6869e9e1a4`

Pinned `mapping.json` SHA-256:
`afb1e2abbff684d6860ed0939655bca3124bf4463ab963349c4936a94377800a`

## Finding

The labels are conditionally fit for binary anomaly-window research, but the
source is not yet fit for unrestricted training or fault-cause prediction.
The pinned dataset card describes physically constrained expert evaluation.
The pinned `mapping.json` contains 1,396 flight keys and 1,407 annotations:

| Source class | Annotations |
| --- | ---: |
| Normal | 901 |
| External Position | 198 |
| Uncategorized | 141 |
| Altitude | 78 |
| Mechanical | 47 |
| Global Position | 42 |

Only 364 annotations contain time ranges; 1,043 have empty ranges. Eleven
flights have multiple annotations. Therefore a class name alone must not be
expanded into synthetic anomaly intervals.

## Pilot mapping

- Three pilot flights are expert-labeled `Normal`.
- One flight has overlapping `Altitude` and `Mechanical` ranges and is usable
  for the binary `anomalous` target.
- One `Uncategorized` flight maps to `unknown` and is excluded from training
  and evaluation.
- Source annotation timestamps, notes, and original filenames are omitted from
  the committed label manifest.
- Source classes are preserved verbatim. No SkyForge fault family is assigned:
  the observed `Mechanical`/`Battery` and `Altitude`/`Roll Rate` combinations
  show that automatic cause mapping would overstate the ground truth.

## Admission rules

1. Join labels to payloads by the pinned source mapping, then replace the
   source name with the inventory SHA-256 and neutral flight ID.
2. Accept only source classes in the reviewed class vocabulary. Map
   `Uncategorized`, missing labels, malformed intervals, and unresolved
   conflicts to `unknown`.
3. Convert source microseconds to canonical milliseconds exactly once. Require
   `0 <= start < end` and require every interval to overlap the parsed flight.
4. Use explicit ranges for anomalous windows. Do not infer ranges from class
   names, notes, rule hits, crashes, or filenames.
5. Use normal flights only for normal windows. Apply boundary padding around
   anomaly ranges before sampling negative windows from a mixed flight.
6. Keep `fault_family` null unless a reviewed, documented class mapping is
   approved. Binary anomaly labels and cause labels are separate targets.
7. Deduplicate by raw-payload hash before any split.

## Leakage controls

- Split by a stable flight-group ID before windowing; never randomly split
  windows from the same flight.
- Related flights from the same collection session, airframe, operator, or
  repeated mission must remain in one split. Produce the group ID with a keyed
  pseudonymization process so raw dates and identifiers are not committed.
- Fit normalization, imputation, feature selection, thresholds, and calibration
  on the training split only.
- Hold out complete groups for validation and test. Freeze the test manifest
  before model iteration and prohibit test-driven threshold tuning.
- Exclude filenames, absolute/UTC timestamps, device IDs, system IDs,
  annotation timestamps, free-text notes, and split identifiers from features.
- Report metrics per flight and per collection group in addition to per window.

## Gate decision

Pilot label fitness: **conditional pass** for binary anomaly-window pipeline
development. Full-source admission and model training remain blocked until
privacy-preserving group IDs, a frozen split manifest, interval validation for
the admitted corpus, and explicit minimum class/group coverage are available.
