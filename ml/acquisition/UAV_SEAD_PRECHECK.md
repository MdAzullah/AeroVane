# UAV-SEAD Phase C precheck

Reviewed: 2026-09-25

## Frozen source

- Repository: `aykutkabaoglu/uav-flight-anomaly-dataset`
- Revision: `774a336a1d1d06b248927a35c2ea1f6869e9e1a4`
- Repository last modified: 2026-05-19T17:48:03Z
- DOI: `10.57967/hf/7772`
- API state at review: public, `gated=false`, reported storage 29,779,885,670 bytes

The repository may change after this review. Every pilot URL must pin the
revision above; `main` is not an admissible acquisition reference.

## License and attribution

The dataset card and repository metadata declare Creative Commons Attribution
4.0 International. Canonical legal text:
`https://creativecommons.org/licenses/by/4.0/legalcode.txt`

Legal-text SHA-256:
`9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411`

Required attribution records must include the dataset title, Aykut Kabaoglu and
Sanem Sariel, the DOI/repository link, CC BY 4.0 with a license link, the frozen
revision, and a description of AeroVane transformations. The paper citation in
the dataset card must be retained with model and dataset documentation.

## Provenance finding

The source is the named curator's repository, linked to the dataset paper and a
versioned DOI. This is sufficient for a bounded parser/inventory pilot. It does
not prove every individual flight's collection consent; that residual risk is
handled by the privacy restriction below and remains part of the pilot review.

## Privacy plan

- Download at most five specifically listed `.ulg` files into isolated ignored
  storage; do not clone or bulk-fetch the approximately 29.78 GB repository.
- Treat coordinates, UTC timestamps, device IDs, system IDs, free text, and
  filenames as potentially identifying.
- Default ULog conversion excludes latitude/longitude.
- Do not commit raw logs, canonical payloads, original filenames, or exact
  timestamps. Versioned manifests use local neutral names and content hashes.
- Do not upload the pilot or derived records to another service.
- Delete the pilot if integrity/schema review fails or authorization is revoked.

## Precheck result

License, provenance, and privacy-plan prechecks pass for a bounded Phase C
pilot only. Integrity, schema, and duplicate checks remain false. The source is
not approved for training or evaluation.
