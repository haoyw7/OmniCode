# LongMemEval: local oracle evidence subset

18 distinct original oracle records, three from each of six question types.
15 objective cases include four abstentions and preserve string/integer source
answers. Three `single-session-preference` records retain their original long
rubric paragraphs privately but are **evidence-retrieval-only**:
`answerSemantics: not_graded`. These three do not emit an answer-accuracy metric.
Their final text is checked only for shape/nonemptiness; a passed result makes
no claim about recommendation quality or semantic correctness.

This is **not the official LongMemEval score or a full long-memory benchmark**.
The oracle source has a small, already selected evidence pool. In these records
all available sessions are answer sessions, so evidence selection is easy.
It does not exercise official S/M ingestion, retrieval among distractors, the
official semantic evaluator, or persistence across episodes.

`list_sessions` exposes neutral IDs and dates; `read_session` exposes full
role/content messages. Upstream `answer_*` IDs, `_abs` suffixes, `has_answer`
labels, gold answers and answer-session IDs are not exposed in prompt/tool
results. Immutable full original records remain in
`../../data/upstream/longmemeval-oracle-sample` and private case `data`.
Metadata such as the test case ID is for the harness and must not be sent as
additional model context. Each fresh episode has its own read set.

Final output is exactly `{"answer": ..., "evidence_session_ids": [...],
"abstain": false}`. Every gold session must actually have been read, and the
submitted evidence IDs must be a duplicate-free exact set match. Abstentions
require `abstain: true` and `answer: null`; their explanatory prose is not judged.
Other objective answers use Unicode NFKC, case folding, whitespace collapse,
terminal `.!?` removal, and canonical numeric scalar normalization. Units,
names, currency notation and all other text must match; paraphrases and extra
explanations may fail. This is deliberately labeled strict normalized matching,
not semantic grading. Unknown calls/arguments/sessions fail program assertions.

Rebuild: `python3 host/bots/eval/public/longmemeval/build_subset.py`.
Validate with `python3 -m unittest discover -s host/bots/eval/tests -p test_public_memory_calls.py`.
Reference scripts exercise adapter/harness plumbing only. No LLM judges or
model calls are made. Runtime uses only Python standard library.

Source: [LongMemEval cleaned dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/tree/98d7416c24c778c2fee6e6f3006e7a073259d48f).
The dataset card declares MIT; the exact card is preserved as `DATASET_CARD.md`.
`UPSTREAM_CODE_LICENSE` preserves the separately imported repository code
license and is not substituted for a dataset license. See `NOTICE` and manifest
for revision, selection, checksums, and scope.
