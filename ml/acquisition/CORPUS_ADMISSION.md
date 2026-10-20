# Controlled-experiment corpus admission

The first real-data model experiment may start only when every check in
`ml/configs/corpus_admission.json` passes. The minimum corpus includes 120
eligible flights from at least 60 independent privacy-safe groups, including
at least 40 anomalous flights and 60 normal-only flights. It must yield at
least 1,000 anomalous and 3,000 normal windows with at least 95% availability
for every frozen feature.

The frozen group split must contain at least 36 training, 12 validation, and
12 test groups, with both normal and anomalous windows in every active split.
The source must be registry-approved and the split manifest must explicitly
authorize training. Passing these minimums permits a controlled experiment;
it does not approve production deployment.

Run the readiness assessment with:

```bash
python3 ml/acquisition/check_corpus_readiness.py \
  ml/configs/corpus_admission.json feature-quality.json groups.json \
  splits.json ml/manifests/dataset_registry.json --output readiness.json
```

Use `--require-ready` in the eventual training command or CI gate so an
incomplete corpus returns a failure status.

## Current pilot

The five-flight pilot passes 3 of 17 checks. It has complete feature coverage,
a frozen split, and confirms that preprocessing did not fit a model. It fails
all quantity, active-split, source-approval, and training-authorization gates.
The largest observed shortfalls are 997 anomalous windows, 39 anomalous
flights, and 59 independent groups.

The expansion proposal is deliberately non-authorizing. Any acquisition must
remain in batches of no more than five flights and 512 MiB, each covered by a
new authorization and selected from reviewed, ranged label metadata.
