# Canonical schema rules

`canonical-telemetry-sample.schema.json` is the interchange contract for
dataset ingestion and exported replay fixtures. The browser's TypeScript
`TelemetrySample` is the runtime counterpart; browser-internal samples omit
`schemaVersion`, which must be added when serializing an interchange record.

Rules:

- Values are finite numbers in the declared unit.
- Missing, invalid, or source-sentinel values are omitted from `values`; they
  are never replaced with zero.
- `availability[signal]` states whether a measurement exists in this sample.
- `qualityFlags` explains measurements that should be excluded, treated with
  caution, or considered estimated.
- Unknown vehicle types use family `unknown` and remain rules-only.
- Coordinates and identifying metadata are excluded from training tensors even
  when present in the canonical ingestion record.

Validate an extracted JSONL file before dataset admission:

```bash
python3 ml/schemas/validate_canonical.py data/interim/flight.jsonl
```

The semantic validator supplements JSON Schema by enforcing relationships
between `values`, `units`, `availability`, and `qualityFlags`.
