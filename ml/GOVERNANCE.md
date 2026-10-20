# ML data governance policy

Version: 1.0.0  
Owner: AeroVane maintainers  
Review trigger: before any new source, new use, or public model release

## Data admission

Every source requires a registry record, immutable source/version identifier,
retrieval timestamp, cryptographic checksums for acquired files, license text
or a stable license reference, citation, provenance, allowed uses, and an
explicit decision. License, provenance, privacy, integrity, schema, and
duplicate checks must all pass before training. Unknown or conflicting terms
mean quarantine, never implicit approval.

A Phase C pilot is the sole payload exception for a quarantined source. It
requires completed license, provenance, and privacy prechecks plus a separately
validated authorization naming an immutable version, flight limit, byte limit,
reviewer, and expiry/status. The pilot is restricted to inventory, parser,
integrity, schema, privacy, and duplicate review. It cannot supply training or
evaluation examples and cannot authorize bulk acquisition.

Raw data is immutable and stored outside Git under `data/raw/<source>/<version>`.
Derived data and split manifests must point back to content hashes. Duplicate
content is removed before splitting. Bulk acquisition requires a separately
approved Phase C pilot inventory.

## Privacy and consent

Coordinates, vehicle/system identifiers, operator text, original filenames,
and precise wall-clock timestamps are removed or coarsened unless a reviewed
feature requirement makes them necessary. Attribution and provenance remain
in manifests, not training tensors. Access is least-privilege and local by
default; raw user logs are never uploaded automatically.

User-provided logs require explicit, revocable opt-in consent describing the
data, purpose, retention period, access, sharing, and deletion process. Public
availability alone does not waive the source license or this privacy review.
Logs involving bystanders, sensitive sites, or embedded credentials are
quarantined pending review.

## Retention and deletion

- Quarantined samples: retain no payload; retain the decision metadata.
- Approved public raw data: retain only while its registered purpose and
  license remain valid; review at least annually.
- Consented user raw data: use the shorter of the consented period or one year,
  then delete or renew consent.
- De-identified derived data and artifacts: review annually and whenever the
  source permission or consent changes.

A verified deletion request removes raw files, derived rows, cached copies,
and future-training eligibility. Published immutable artifacts cannot be
silently rewritten; they are withdrawn, documented, and superseded. Deletion
is recorded by source ID and hashes without retaining deleted personal data.

## Security and incidents

Suspected leakage, license breach, corrupt provenance, or mislabeling freezes
the affected source and downstream artifacts. Maintainers record discovery,
scope, hashes, affected runs, containment, notification obligations, deletion
or remediation, and approval to resume. Affected models are not promoted while
review is open. Safety incidents preserve evidence with access controls and
receive human review; model output is advisory evidence, not a diagnosis.

## Roles and approval

The contributor records provenance and checksums. A maintainer reviews
technical/privacy controls. The project owner approves allowed use; qualified
legal review is required where terms are ambiguous. One person must not both
submit and finally approve consented private data.
