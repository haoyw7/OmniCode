# Executable public benchmark subsets

This adds **200 executable variants from 176 distinct public problems**. Four newly integrated sources contribute **128 distinct problems / 152 variants**; the previously imported BFCL 30 and LongMemEval 18 now have executable graders. These counts exclude unselected raw downloads and do not count clean/attack pairs as independent problems. Alongside the original 176 MonoCode cases, there are **376 runnable variants / 352 distinct authored-or-public problems**.

| Source                               | Distinct problems | Variants | Executed scoring                                                         | Scope / limitation                                                                             |
| ------------------------------------ | ----------------: | -------: | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [BFCL](bfcl/README.md)               |                30 |       30 | Exact candidate/schema and unordered call matching                       | Local stricter metric; receipt-only tools, not official AST/function execution                 |
| [LongMemEval](longmemeval/README.md) |                18 |       18 | Actual evidence reads; 15 strict answer/abstention checks                | Oracle evidence, not S/M memory; 3 preferences retrieval-only, answer semantics ungraded       |
| [tau-bench](tau_bench/README.md)     |                24 |       24 | Native tools, full database terminal hash, required outputs              | 12 retail + 12 airline; fully disclosed user brief and preauthorization replace user simulator |
| [API-Bank](api_bank/README.md)       |                32 |       32 | Native ToolManager/API checker, exact output, full state and trace       | 32 APIs/dialogues, 8 domains; next-tool continuation, not full conversation or ToolSearcher    |
| [HotpotQA](hotpotqa/README.md)       |                48 |       48 | Pinned official answer/support/joint metrics plus read/citation checks   | 24 bridge + 24 comparison, all hard; 10 local distractor passages, no web/fullwiki             |
| [BIPIA](bipia/README.md)             |                24 |       48 | Pinned official MatchRef attack rule and independent local answer checks | 24 clean/attacked pairs; 2 attacks × 3 positions, EmailQA only                                 |

All model runs use the actual MonoCode `buildBrainPrompt` through the existing Pi CLI and the supplied local tool schemas. They bypass Host orchestration/UI and use **simulated extensions** rather than claiming the product natively supports these external APIs. The original suite and native Host tests remain separate. No source is represented as an official leaderboard score.

## Run

From the repository root, with existing Node dependencies, Python 3.10–3.14 and `jsonschema==4.19.2`:

Evaluation commands automatically prepare their required datasets outside the checkout. The first preparation downloads pinned upstream inputs and rebuilds the selected subsets; it needs network access and the corresponding importer dependencies. Prepared payloads are checked against `../data/datasets.lock.json` before use. A matching cache can be reused offline, and preparing data makes no model request.

The default cache is `${XDG_CACHE_HOME:-~/.cache}/monocode/eval/<lock-hash>/`. Set `MONOCODE_EVAL_CACHE` to change its base directory, or `MONOCODE_EVAL_DATA_ROOT` to use an explicit complete data root. Unit tests read prepared caches; the verification command below prepares all public sources first.

To prepare data separately, run `python3 host/bots/eval/bin/prepare_data.py --sources bfcl,longmemeval`. Omitting `--sources` also prepares the original suite, which requires its configured external input directory or HTTPS base URL; see [data configuration](../README.md#数据准备). A cold HotpotQA rebuild requires `pyarrow` (the importer was verified with `23.0.1`), and BIPIA requires `nltk==3.9.2` plus `pandas`. Dependencies are never installed automatically and are unnecessary once their complete cache is present.

```bash
python3 host/bots/eval/bin/verify_public.py
node host/bots/eval/bin/public_eval.mjs list
node host/bots/eval/bin/public_eval.mjs run --mode reference --out /tmp/public-reference-NEW
python3 -m unittest discover -s host/bots/eval/tests -p 'test_public_*.py'
node_modules/.bin/vitest run --config host/bots/eval/vitest.config.ts host/bots/eval/tests/public-runner.test.ts
```

`--ids` selects comma-separated exact IDs; `--sources` defaults to all six. `--model` defaults to `openai-codex/gpt-5.6-luna`. Step limit defaults to 32 because one original tau trajectory needs 20 calls plus final. Each model call has a 60s default timeout, each bridge command 30s. No automatic model retries are performed. Tools support identical request-ID retries; changed inputs under the same key fail. Read-only `list` makes no model request.

`--max-requests` and `--max-usd` bound the shared run budget; per-call reservation defaults to $0.01. Reported model cost is nominal usage metadata, not a new billing assertion; the estimator is not a provider-enforced dollar cap, so allow margin. Existing authentication stays in the Pi process. No credentials are copied/read by the benchmark bridge. The CLI disables native tools, MCP, extensions, skills and context files. Every case gets a fresh Python process and fresh fixture state. Its environment is cleared, and audited adapter code is denied network, subprocess and filesystem mutation by a Python audit hook. This is defense in depth for the allowlisted code, **not an OS sandbox for arbitrary Python**.

## Reports and grading

Each fresh output directory must be outside the checkout and contains `manifest.json`, `results.jsonl`, `summary.json`, and `report.md`. Existing directories are never overwritten. Historical `reports/...` paths resolve beneath `MONOCODE_EVAL_ARCHIVE_ROOT`, defaulting to `${XDG_DATA_HOME:-~/.local/share}/monocode/eval-archive`. Per-case records retain source IDs, source/transformation metadata, case hash, tool trace, raw model final outputs, checks, metric values, error classes, latency/tokens/cost. The source artifact hash lock is checked before model calls. Reports capture its hash plus exact adapter/manifest hashes.

Real inference remains subject to the archived pause conditions, spending gates and cumulative ledger. Moving data or reports does not resume requests, reset budgets or authorize new model calls.

Reference replay is labeled **harness-reference-NOT-agent-score**. Real rows are labeled **real-pi-native-brain-isolated-public-tools**. Environment and budget errors remain separate from ability failures and are excluded from ability denominators. Scores are grouped by source/category, with metric-specific means. BIPIA additionally reports clean/attacked answer accuracy, attacked-only ASR and observed pair degradation. LongMem preference rows never contribute an answer-accuracy metric. New public transport accepts a plain terminal answer, while malformed tool envelopes fail; this does not alter historical original-suite scores.

No LLM judge is used in these deterministic adapters. The existing failed judge calibration, untrusted raw evidence, null formal rubric rate and safety hard gates remain unchanged. Semantic evaluation can be added only through the existing calibrated judge path; do not promote self-evaluation or uncalibrated scores to ground truth.

## Provenance and reproducibility

Each repository folder retains licenses/notices, revision and SHA256 manifests, deterministic import/build scripts, seed, selection and exclusion reasons. Original records, generated cases and runtime fixtures live in the external cache. `integrity.json` uses stable logical paths to lock public artifacts and the BFCL/LongMem raw inputs across repository and cache locations; historical report paths and payload hashes remain unchanged. After intentional source changes and review, maintainers can regenerate it with `python3 host/bots/eval/bin/verify_public.py --write-lock`; ordinary runs must not rewrite it.

Code and data licenses are recorded separately. HotpotQA data is CC-BY-SA-4.0, grader code Apache-2.0; the official CMU endpoint failed, so the imported data uses a pinned HF parquet mirror and does not claim CMU byte identity. API-Bank's publisher HF card declares MIT data and its repository code Apache-2.0; structured companion dialogue metadata has no separate data license file, and its mapping evidence/limitation is retained. BFCL is Apache-2.0; LongMem cleaned data MIT; tau bundled assets MIT; BIPIA EmailQA/two attacks MIT, excluding other dataset license scopes.

AgentDojo, tau2, ToolSandbox, AssistantBench, GAIA, OSWorld, WorkArena, BrowseComp and AppWorld remain source/import manifests, **not executed integrations**. Their environment, access or license limitations are in `../data/sources.json`.

To add a source, follow `ADAPTER_CONTRACT.md`: preserve originals and provenance; expose only pre-target user context and tools; keep gold/reference private; implement fresh Episode state, program assertions, negative/reset tests; pin/check licenses and artifacts; then validate references and a separately budgeted real smoke. Never count format validation or gold replay as agent success.
