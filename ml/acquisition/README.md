# Phase C pilot acquisition

Only a registry-approved source may enter the reusable corpus. A quarantined
source may place a strictly bounded payload under an isolated `data/raw` pilot
directory only after the separate authorization below validates. Download
credentials, access tokens, consent records, and personal information must
never be committed.

For a quarantined source, validate the separate bounded pilot authorization
before downloading any payload:

```bash
python3 ml/acquisition/validate_pilot_authorization.py authorization.json
```

This exception exists only to complete integrity, schema, duplicate, privacy,
and parser checks. It never permits training, evaluation, or bulk acquisition.

After an approved pilot is acquired, build its immutable inventory:

```bash
python3 ml/acquisition/build_inventory.py \
  data/raw/<source>/<version> \
  ml/manifests/<source>-<version>-inventory.json \
  --source-id <registry-id> \
  --source-version <immutable-version>
```

The inventory contains relative paths, sizes, SHA-256 hashes, detected formats,
and content-hash duplicates. It deliberately excludes absolute paths, file
contents, coordinates, operator details, and credentials.

Before parsing a pilot:

1. Confirm the source registry decision and permitted use.
2. Freeze the exact release/revision and archive the applicable license hash.
3. Verify downloaded checksums when the publisher supplies them.
4. Build this inventory and inspect unknown/archive formats.
5. Scan archives before extraction and reject path traversal or links.
6. Run format ingestion and canonical validation.
7. Record readable flights, failures, actual storage, duration, topics, and
   privacy findings. Do not bulk-download based on pilot success alone.

Archive inspection is non-extracting and fails closed:

```bash
python3 ml/acquisition/inspect_archive.py pilot.zip --output pilot.archive-report.json
```

A non-zero exit means extraction is prohibited. ZIP and TAR variants are
supported; other formats remain blocked until a comparably safe inspector is
implemented.

Before any window generation or model training, validate group and split
manifests against the inventory, labels, and registry:

```bash
python3 ml/acquisition/validate_splits.py \
  groups.json splits.json inventory.json labels.json \
  ml/manifests/dataset_registry.json
```

The validator requires exact hash coverage, keeps every collection group in
one partition, excludes unknown/ineligible labels, and rejects active
train/validation/test assignments for a source that is not registry-approved.
When collection relationships are unavailable, place the entire pilot in one
conservative group; never guess independent groups to obtain a convenient
split.

Candidate batches can be proposed from pinned annotation and repository-index
metadata without downloading payloads:

```bash
python3 ml/acquisition/select_candidates.py \
  mapping.json repository-index.json data/private/grouping.key \
  ml/acquisition/plans/batch-proposal.json \
  data/private/batch-source-map.json \
  --source-id <registry-id> --source-version <immutable-version> \
  --exclude-private-map data/private/prior-pilot-source-map.json \
  --exclude-private-map data/private/prior-batch-source-map.json
```

The selector targets three explicitly ranged anomaly flights and two normal
flights, prefers distinct collection groups, and enforces five-file/512 MiB
limits. Public proposals contain neutral IDs and keyed opaque tokens only.
Exact repository paths and the HMAC grouping key belong under Git-ignored
`data/private`. A proposal always has `download_authorized: false`; it must be
reviewed and converted into a separate authorization before acquisition.
Every previously acquired cohort's private map must be supplied as a repeated
`--exclude-private-map` argument so no earlier payload can be proposed again.
