# Public-suite adapter contract

Each source owns `host/bots/eval/public/<slug>/adapter.py`, `cases.jsonl`, `manifest.json`, LICENSE/NOTICE and optional curated vendored code/assets. Do not change the existing 176-case suite or judge trust gate.

The adapter is loaded by path with importlib. It must only use Python stdlib plus explicitly documented installed dependencies; no network/inference/credentials at runtime. All effects stay in per-Episode memory or its temporary fixtures. No upstream agent provider, user simulator, web browser or real app connections.

`load_cases()` returns JSON-serializable dicts with `id` (globally unique source/upstream/variant), `source`, `upstream_id`, `category`, `variant`, `provenance`, and private `data` (original record/config). Preserve source/original records separately if local adaptation changes prompts. Provenance: official_url, license_url, revision, sha256, upstream_id, split, variant, transformation, seed, env_requirement. Manifest: total imported original records vs executable variants separately, source checksums/version/license, selection/filter/exclusion rules, statuses. SHA256 + ID deduplicate before sampling; seed 17 except upstream protocol fixes another seed.

`class Episode(case, seed=17)`:
- `start()` -> {prompt: str, tools: [{name, description, parameters: JSON Schema}], messages?: list}. Never include hidden expected actions, gold labels, future user/tool messages. Original context evidence is allowed. Add explicit local output-format instructions when needed and mark adaptation.
- `call(action: str, arguments: dict)` -> JSON-serializable result. Unknown actions/arguments must not run. Native upstream tool behavior may be used only after code audit; local state only. Log/capture mutations for grade checks if needed.
- `grade(final: str, trace: list)` -> {passed: bool, checks: [{name, passed, evidence?}], metrics?: dict}. Trace entries have {action,input,result,requestId}. Program assertions required; no LLM judging. Don't claim an adapted metric is official.
- `reference()` -> list of transport decisions: {calls: [{action, requestId, input}], final?: str}. Final is user-facing text, often JSON serialized to a string. These scripts validate harness only, not agents. Fresh reference tests must execute calls then grade; also test malformed/wrong answers/actions fail and reset isolates state.

Runner may call the same requestId with identical action/input; bridge caches results. Reusing a key with changed input is a protocol error. Tools are schema-validated centrally. Return ordinary structured errors for tool failures. No infinite retries. Subset counts should reflect distinct upstream problems, with clean/attack variants counted separately.

Contributors should use `host/bots/eval/` in the repository. Keep source-specific changes scoped to `public/<slug>/`, corresponding `tests/test_public_<slug>.py`, and source notes. Do not call models while developing adapters; an explicitly budgeted real-agent run is a separate operation. Return commands, counts, pass/fail/excluded, limits and blockers.
