# API-Bank: 32 executable public continuations

This subset runs **32 distinct API targets from 32 distinct upstream dialogues**, across 8 categories. The targets execute the audited upstream `ToolManager.api_call`, native API implementation, and each API's `check_api_call_correctness`. It uses no model, external service, live account, credential lookup, or network access.

This is an **adapted stateful next-tool continuation benchmark**, not full end-to-end API-Bank dialogue evaluation. Twenty-seven cases have at least two prior user turns; five have shorter context. Twenty cases replay one or two already-observed API calls before the target. The agent performs the next API action, then reports its actual result in JSON. Future dialogue turns, target arguments, expected output, oracle state, and reference scripts are private.

## Coverage

| Category | Executable targets |
| --- | ---: |
| Calendar and reminders | 14 |
| Health records and appointments | 5 |
| Travel and finance fixtures | 3 |
| Document and knowledge lookup | 3 |
| Media fixture tools | 3 |
| Medical knowledge fixture lookup | 2 |
| Arithmetic | 1 |
| Smart home | 1 |
| **Total** | **32** |

Media and medical tools are upstream fixture lookups, not live perception or validated medical advice. Finance and travel calls only change/read synthetic in-memory data. Public fixture usernames, tokens, passwords, URLs, and health records never connect to real accounts or sites.

## Frozen source and licensing

- Dataset: [publisher's Hugging Face dataset](https://huggingface.co/datasets/liminghao1630/API-Bank), revision `12e8158b7628c168f07e8f31fbbe3445e99f44cf`, `test-data/level-1-api.json` (399 records) and `level-2-api.json` (135 records). `raw/DATASET_CARD.md` is the exact publisher card declaring MIT.
- Executable code and mock fixture state: [AlibabaResearch/DAMO-ConvAI/api-bank](https://github.com/AlibabaResearch/DAMO-ConvAI/tree/f30ccf22b4e2617fab32958d4c03f5c1f2e7dfcf/api-bank), revision `f30ccf22b4e2617fab32958d4c03f5c1f2e7dfcf`, Apache-2.0.
- Structured companion dialogues: 214 original JSONL files from the code repository are retained. The upstream README explicitly identifies `lv1-lv2-samples` and HF `test-data` as the conversation data. `raw/data_mapping.json` verifies all 399 level-1 HF expected-call strings exactly against their companion structured targets. The MIT data designation is established by the publisher's dataset card plus this correspondence, **not by treating the code's Apache license as the data license**. See `NOTICE.md` for the exact scope and remaining metadata limitation.

`manifest.json` records revisions, source SHA256, full initial fixture SHA256, counts, transformations, sampling and limits. `vendor_audit.json` records every original/vendored code checksum and patch. Original source bytes are retained in `raw/upstream_code`. The complete upstream 19-file `init_database` is preserved under `fixtures/`, including unselected fixture databases.

## Selection and exclusions

All 534 original raw records remain bundled. The importer deduplicates by `(split, original file, original id)` and canonical raw-record SHA256 before sampling. It maps target position by the number of prior API entries in the original input; original sample IDs are preserved and are **not assumed to be even**, since several dialogues have adjacent API calls.

The importer validates native prehistory and target results before eligibility. Of the 534 original records:

- 205 are eligible after typed transport, safe-tool filtering, and native replay.
- 32 are selected with seed 17: sort IDs, shuffle within API strata, shuffled category round-robin, at most one target per API and dialogue.
- 173 eligible rows are not selected.
- 107 contain a target or earlier tool outside the audited whitelist.
- 73 authentication targets are support-only and not sampled as independent targets.
- 14 fail native schema/replay checks (e.g. incompatible smart-device parameter names, scene-result casing, legacy deletion schema).
- 135 level-2 ToolSearcher records require an embedding model and are excluded. No AST-equivalence or replacement search score is substituted.

Every excluded record has its original ID, split, canonical SHA256 and reason in `exclusions.jsonl`.

## Execution and scoring

`Episode.start()` exposes only original pre-target HF context, allowed tool schemas, and explicit local output-format instructions. Historical tool calls are replayed into a fresh deep copy of the upstream fixtures. The following adaptation is documented and reproducible:

1. String-encoded list/int/float/bool arguments in original records become standard JSON values for import/reference replay. `ast.literal_eval` only decodes trusted fixed list literals; it never grades tool-call text.
2. Standard JSON booleans are bridged to the upstream ToolManager's textual bool convention.
3. The ToolManager constructor uses a static audited registry instead of directory discovery and loading `ToolSearcher`. Five upstream dispatch/initialization/description methods remain byte-for-byte identical as source segments.
4. API package imports become relative. Unused `dump_database` methods are removed. Native tool and checker bodies are unchanged.
5. Tools reject unknown arguments, unknown actions, wrong types and excessive input sizes. Calculator expressions are grammar/depth bounded before reaching the upstream parser.

A case passes only if all six checks pass: authentic locally executed trace, exactly one intended target action, native per-API correctness, native result equal to the recorded output/exception, entire mock database equal to the expected post-action state, and a structured final that reports the executed result. The full-state check catches native checker blind spots: e.g. `RecordHealthData` ignores recorded health values in its own checker. This stricter combined score is **not the official API-Bank score**.

Native errors are JSON-serializable results. No filesystem persistence methods, provider wrappers, upstream evaluators, dynamic tool discovery, search models, email tools, account-modification tools or external API clients are loaded.

## Run and reproduce

```bash
python3 -m unittest discover -s host/bots/eval/tests -p 'test_public_api_bank.py' -v
python3 host/bots/eval/public/api_bank/import_cases.py
```

Re-vendoring from an already-downloaded pinned upstream checkout:

```bash
python3 host/bots/eval/public/api_bank/vendor_sources.py /path/to/DAMO-ConvAI/api-bank
python3 host/bots/eval/public/api_bank/import_cases.py --source /path/to/DAMO-ConvAI/api-bank
```

The test suite executes all 32 references and checks failure, native exceptions, no-op/fabricated answers, forged trace, wrong health-data state, schema rejection, tool isolation/reset, no network imports, original checksums, source-method preservation and hidden-answer exclusion. Reference scripts validate the harness only; they are not agent scores. No LLM judge or judge trust gate is modified.

Known compatibility limit: the unchanged upstream `QueryHistoryToday` date parser emits a Python 3.13+ deprecation warning for month/day-only input. Its current behavior passes here; Python 3.15 changes may require revalidation. The manifest requires Python >=3.10 and does not promise untested future interpreter compatibility.
