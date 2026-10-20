# Format ingestion

The PX4 ULog adapter uses PX4's BSD-3-Clause `pyulog` parser and emits one
canonical JSON object per topic update. Install the isolated dependency and run:

```bash
python3 -m pip install -r ml/requirements.txt
python3 ml/ingestion/ulog_adapter.py input.ulg data/interim/input.jsonl
```

Latitude and longitude are omitted by default. Use `--include-location` only in
an approved restricted workflow; coordinates must still be excluded from model
features. Unsupported topics are ignored, missing values remain unavailable,
and output is deterministically ordered by the ULog monotonic timestamp.

PX4 `vehicle_attitude` quaternions are normalized and converted to Euler
radians. Flight phase is inferred chronologically from arming state and the
authoritative land detector; uncertain intervals remain `unknown`.

`fixtures/generate_minimal_ulog.py` creates a two-record synthetic ULog for
testing the actual parser boundary. It contains no external or flight data.
