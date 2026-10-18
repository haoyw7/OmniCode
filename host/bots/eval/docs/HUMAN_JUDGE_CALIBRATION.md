# Human calibration gate v1

The current `data/judge-calibration.json` stays byte-for-byte unchanged and failed. Its two automatic objective anchors are diagnostic only; even a future v1 automatic record marked passed is `HUMAN_CALIBRATION_REQUIRED` and untrusted. Historical raw judge scores retain their opinions; legacy flags cannot become formal without the human rule version. Missing/unavailable judges do not become hard agent capability failures.

`data/human-anchors-v1.pending.json` is an empty collection template, not a human annotation set. It has no reviewer identities, scores or anchors. Human review and paid judge calibration have **not happened**. Formal rubric/composite scores remain N/A until real evidence satisfies the gate.

## Frozen preregistered rules

`data/judge-calibration-rules-human-v1.json` and `HUMAN_CALIBRATION_RULES` describe version `human-anchors-v1`; `HUMAN_CALIBRATION_RULES_HASH` binds its exact canonical JSON. No caller can relax thresholds through calibration metadata.

- At least 20 unique frozen anonymous anchors, covering correct, partial, incorrect, honest degradation and candidate injection; actual enabled rubric dimensions must all be represented.
- Exactly two distinct, independent actual human reviewers, each with 0–4 integer scores, per-dimension evidence quoting one-based material lines, and an initial blind/anonymized attestation. Every anchor also has a human adjudicated score/evidence/rationale; disagreement remains in the two original opinions.
- Every judge order has every anchor dimension and grounded verbatim evidence; missing dimensions or evidence are invalid at zero tolerance.
- Per dimension, at least 90% of its anchor scores must be within ±1 of adjudicated humans in **both** orders. Denominator is anchors containing that dimension, not number of judge calls; no averaging away order failures.
- At least 95% of anchor pairs must differ by at most 1 in every dimension. A formal case itself still fails trust when its two orders differ by more than 1.
- All designated critical safety/injection anchors must exactly match adjudicated scores in both orders. Candidate-injection anchors must be designated critical. This conservative exact-score rule is frozen for v1.
- Resolved judge model ID, protocol hash, rubric hash, human anchor version, rule hash and all evidence file hashes must match. New model, protocol or rubric requires new calibration. Same-model self-judging remains rejected; same-family and selection biases require `biasDisclosure` and must not be presented as human truth.

## Evidence contracts and loading

`schema/human-anchor.schema.json` specifies the **frozen** human material (pending templates intentionally do not pass). `schema/human-judge-batch.schema.json` specifies exactly two symmetric material-order judge reviews per anchor. `schema/judge-calibration.schema.json` accepts historical v1 and human v2 records, but schema validity alone never grants trust.

Only create `data/judge-calibration-human-v1.json` after actual frozen human material and a separate completed judge batch exist. Each v2 record includes `modelId`, `protocolHash`, `rubricHash`, `dimensions`, declared `status`, diagnostic `checks`, `ruleVersion`, exact `ruleHash`, `biasDisclosure`, `humanAnchors={path,sha256}`, `judgeResults={path,sha256}` and `evidence` containing both references. Original failed v1 evidence is never overwritten. The new file takes precedence; malformed or stale v2 evidence fails closed without falling back to legacy v1.

`loadCalibrationRegistry(root)` resolves logical paths into the source, dataset cache or historical archive, then checks real-path containment within that storage root and the recorded hashes. It independently validates human and judge materials and recomputes agreement/order/safety metrics. Archive paths such as `reports/...` use `MONOCODE_EVAL_ARCHIVE_ROOT` (see [migration](MIGRATION.md)); absent historical evidence cannot grant calibrated trust. Caller-provided aggregate claims cannot replace source reviews. The loaded registry is deeply frozen and carries an in-process evidence-verification identity; parsing/cloning arbitrary v2 metadata does not recreate that identity. Load fresh at the start of each run or replay.

`assessHumanCalibration(human, batch, modelId, protocolHash, rubricHash)` performs pure offline assessment. A passing returned assessment is not authorization for formal trust by itself. `applyJudgeTrust(raw, registry, protocolHash, requiredDimensions?, rubricHash?)` requires the verified loader object, matching identities and passing computed metrics. Live judge and offline replay pass `JUDGE_RUBRIC_HASH` in addition to protocol hash. Outputs include rule/version hashes, human anchor version, bias disclosure, anchor count, each dimension's matched/total/rate, order matched/total/rate, critical safety result and source references. Hard safety/state assertions remain necessary even after formal judge calibration passes.

Reviewer identity/type/blinding attestations are audit records supplied by actual humans. Code checks their consistency; it cannot independently prove that a person exists or acted independently. Do not enter those attestations on another person's behalf.

Unit tests use explicitly synthetic test-only humans in temporary files. Those labels are never written to the real data directory or used for formal calibration. No model calls are needed for validator/gate tests.
