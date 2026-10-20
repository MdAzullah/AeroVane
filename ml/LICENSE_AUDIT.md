# Dataset license audit

Reviewed: 2026-09-25  
Commercial compatibility required: yes

This engineering audit records the public terms found at review time. It is
not legal advice. A license check answers only whether usable permission is
documented; it does not replace provenance, privacy, integrity, schema, or
duplicate review.

| Source | Finding | Phase A decision |
|---|---|---|
| UAV-SEAD | The official dataset card declares CC BY 4.0. On 2026-09-25 the public API reported `gated=false` at frozen revision `774a336a…`; canonical license text was hashed. | Quarantine for training; bounded Phase C pilot authorized to finish integrity/schema/duplicate checks. |
| ALFA | The official repository provides downloads and citation instructions but no dataset license grant was found. Citation is not a substitute for permission. | Quarantine; obtain explicit commercially compatible terms from the owner. |
| RflyMAD | The official page restricts the dataset and related work to non-commercial situations and asks commercial users to contact the owner. | Reject from commercial training/evaluation unless written permission is obtained. |
| PX4 public Flight Review | Official PX4 documentation explicitly permits public logs for statistical analysis and machine learning and calls them “CC-BY PX4.” It does not state the CC version or complete attribution requirements on that page. | Quarantine until exact license/version and per-log privacy/provenance controls are frozen. |
| ArduPilot AutoTest | Official pages make build outputs available and describe generated logs, but no explicit license for the output dataset was found. The source-code license does not automatically answer this question. | Quarantine; request clarification or generate a controlled in-project corpus. |
| AeroVane SITL | AeroVane can license its scenario definitions and generated factual telemetry, subject to simulator and asset terms. | Quarantine until commits, dependencies, missions, seeds, and notices are frozen. |
| Consented user logs | Rights do not exist until each contributor makes an explicit, revocable grant for the described purposes. | Quarantine until the consent and deletion workflow exists. |

## Evidence

- [UAV-SEAD dataset card](https://huggingface.co/datasets/aykutkabaoglu/uav-flight-anomaly-dataset)
- [Hugging Face gated-dataset behavior](https://huggingface.co/docs/hub/datasets-gated)
- [ALFA official repository](https://github.com/castacks/alfa-dataset)
- [RflyMAD official license section](https://rfly-openha.github.io/documents/4_resources/dataset.html)
- [PX4 statistical flight-log analysis documentation](https://docs.px4.io/main/en/dev_log/flight_log_analysis_statistical)
- [ArduPilot AutoTest output](https://autotest.ardupilot.org/)
- [ArduPilot AutoTest framework](https://ardupilot.org/dev/docs/the-ardupilot-autotest-framework.html)

## Required follow-ups

1. Recheck UAV-SEAD access and license metadata before acquisition and keep all
   pilot URLs pinned to the audited revision.
2. Ask ALFA maintainers for explicit dataset terms covering commercial model
   training, evaluation, redistribution of derived features, and model release.
3. Ask PX4 maintainers to identify the CC-BY version and required attribution.
4. Ask ArduPilot maintainers to clarify reuse terms for public AutoTest output.
5. Do not request or download payloads until the relevant registry entry is
   approved and the Phase C pilot is authorized.
