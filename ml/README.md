# AeroVane machine-learning workspace

AeroVane ML is an advisory anomaly-warning system. It does not diagnose a
root cause, control a vehicle, change parameters, or trigger a failsafe.

The Live Viewer currently embeds two portable models from this workspace:

| Model | Kind | Trained on | Report |
|---|---|---|---|
| `aerovane-real-anomaly-2.0.0` | Binary decision tree | Reviewed UAV-SEAD flights | [`experiments/UAV_SEAD_EXPERIMENT_2_REPORT.md`](experiments/UAV_SEAD_EXPERIMENT_2_REPORT.md) |
| `aerovane-basic-sensor-1.0.0` | Multiclass dense network | Simulated sensor data only | [`experiments/BASIC_SIMULATED_SENSOR_CLASSIFIER_1_REPORT.md`](experiments/BASIC_SIMULATED_SENSOR_CLASSIFIER_1_REPORT.md) |

The earlier `aerovane-anomaly-1.0.0` synthetic prototype was retired on
2026-10-29 (see [DATASET.md](DATASET.md)).

## Running tests

```bash
cd ml
python3 -m pip install -r requirements.txt
python3 -m pytest -q
```

`pytest.ini` puts `ingestion/`, `preprocessing/`, and `governance/` on the import
path, so the whole suite runs from `ml/`. If an unrelated globally installed
pytest plugin (for example from ROS) breaks collection, run with
`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`.

## Governance gate

No dataset may enter the training corpus until its registry entry has
`decision: "approved"`, all approval checks are `true`, and the permitted use
includes the intended activity. A quarantined source is metadata-only unless a
separate bounded Phase C pilot authorization passes license, provenance, and
privacy prechecks. Pilot payloads may be used only to complete integrity,
schema, duplicate, and parser checks—never training or model evaluation.

## Training preflight

Install the exact environment with `python3 -m pip install -r ml/requirements.txt`,
then run the fail-closed preflight before a controlled training run:

```bash
cd ml
python3 check_training_start.py \
  --readiness manifests/uav-sead-reviewed-v1-readiness.json \
  --authorization manifests/uav-sead-reviewed-v1-training-authorization.json \
  --windows ../data/processed/uav-sead-reviewed-v1/windows.jsonl \
  --features configs/window_features.json \
  --inventory manifests/uav-sead-reviewed-v1-inventory.json \
  --labels manifests/uav-sead-reviewed-v1-labels.json \
  --groups manifests/uav-sead-reviewed-v1-groups.json \
  --splits manifests/uav-sead-reviewed-v1-splits.json \
  --feature-quality manifests/uav-sead-reviewed-v1-feature-quality.json
```

It checks every readiness result, the explicit authorization, all five bound
manifest hashes, frozen input availability, and exact training-library
versions. Any mismatch exits nonzero. Training remains train-only, model
selection remains validation-only, and an experiment's final test cohort may
be evaluated only once.

## Portable model contract

`schemas/portable-tree-model.schema.json` defines the versioned browser-neutral
decision-tree format. `model_contract.py` and
`apps/live-viewer/src/analysis/portable-tree-model.ts` implement matching fail-closed
reference scorers. `export_portable_model.py` converts an accepted local
joblib pipeline without rerunning evaluation and binds the JSON to the accepted
report and experiment configuration hashes. Export does not authorize viewer
integration or operational release.

The project remains commercially usable. Data restricted to non-commercial
use is excluded from training unless the rights holder grants compatible
written permission. Registry approval is a technical control, not legal
advice.

Run the Phase A checks from the repository root:

```bash
python3 ml/governance/validate_registry.py
```

## Frozen taxonomies

Model routing uses these vehicle families:

- Tier 1: `multicopter`, `fixed_wing`
- Tier 2: `vtol_hybrid`, `ground_rover`, `surface_vessel`
- Tier 3: `submersible`, `lighter_than_air_other`

Window labels are `normal`, `unknown`, or `anomalous`. Fault families are
`power`, `propulsion_actuator`, `vibration_mechanical`,
`navigation_state_estimation`, `sensor`, `communication`, `thermal`,
`control_tracking`, `environment`, and `operator_configuration`.

Specific causes may be assigned only from dataset ground truth or expert
review. Rule hits are weak labels and must remain identified as such.

The authoritative machine-readable definition is
[`configs/taxonomy.json`](configs/taxonomy.json). Dataset registry vehicle
families are checked against it.

See [GOVERNANCE.md](GOVERNANCE.md) for retention, privacy, consent, deletion,
and incident-review policy. See [LICENSE_AUDIT.md](LICENSE_AUDIT.md) for the
dated source review. The source decisions are in
`manifests/dataset_registry.json`; its JSON Schema is in `schemas/`.
Operational templates for source intake, consent, deletion, and incidents are
under `governance/templates/`. Completed records must be stored in restricted
operational storage, not committed when they contain personal information.

Phase B's canonical schema and ingestion work is complete. See
[`PHASE_B_COMPLETION_REPORT.md`](docs/phase-reports/PHASE_B_COMPLETION_REPORT.md) and
[`ingestion/SOURCE_COMPATIBILITY.md`](ingestion/SOURCE_COMPATIBILITY.md).
