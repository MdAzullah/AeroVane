# Deterministic window preprocessing

`build_windows.py` converts canonical JSONL into overlapping five-second
windows with a 2.5-second stride. It calculates only the features frozen in
`ml/configs/window_features.json`.

An anomaly range labels every overlapping window `anomalous`. The two-second
boundary around a range is `unknown`, preventing uncertain transition samples
from becoming negative examples. An `Uncategorized` flight remains `unknown`.

The output includes neutral flight/hash/group/split metadata for lineage, but
those values are outside the `features` object and cannot be model inputs.
Coordinates, UTC time, filenames, device IDs, notes, and source annotation
timestamps are never emitted as features. Missing feature values are `null`;
the builder does not fit or apply imputation.

Example:

```bash
python3 ml/preprocessing/build_windows.py \
  data/interim/<source>/<revision> \
  ml/manifests/<labels>.json \
  ml/manifests/<splits>.json \
  data/processed/<source>/<revision>/windows.jsonl \
  ml/manifests/<feature-quality>.json
```

Run split validation first. Feature normalization and imputation may be fitted
only after an approved training partition exists and must use that partition
alone.
