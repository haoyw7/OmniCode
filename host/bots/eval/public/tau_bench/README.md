# tau-bench: executable legacy snapshot, local protocol

This adapter runs 24 distinct upstream test tasks, 12 retail and 12 airline, with
the complete original mock databases and audited upstream tool implementations.
It uses Python 3.10+ and the standard library only. No provider package, credential,
network access, model call, or live user simulator is needed.

The pinned repository is [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench),
revision `59a200c6d575d595120f1cb70fea53cef0632f6b`, package version `0.1.0`.
Its README says these tasks are outdated and points to the later tau2/tau3 work.
This suite deliberately identifies itself as that legacy snapshot.

## What executes

Each `Episode` deep-copies the full retail or airline database. Tool classes run
their original `invoke` implementations on that copy. Tools can find users,
inspect complete orders/products/flights/reservations, search flights, cancel,
modify addresses or payments, exchange or return items, and book or update
reservations. This is an actual stateful tool environment, not a set of prompts.
All 16 retail and 14 airline tool schemas are exposed. `think` is a native no-op;
`transfer_to_human_agents` returns the native simulation string and ends the local
episode without contacting anyone.

Native source files are preserved byte-for-byte under `private/upstream/`. The
loader removes only the `Tool` base-class import, replacing it with an inert local
base class; it does not import the upstream agent, user simulator or providers.
The native calculator's `invoke` method is removed before compilation and replaced
with a bounded arithmetic AST evaluator. No native calculator `eval` is run.

Local boundaries reject unknown actions, unknown nested fields, invalid types,
oversized values, and nonfinite numbers. Results have the wrapper
`{"ok": true, "result": ...}` or `{"ok": false, "error": ...}`. Successful JSON
tool strings are decoded; other strings are retained. Each tool runs on a scratch
copy and commits only on success, so errors do not leave partial changes.

## Protocol and score limits

The native benchmark normally uses a separate LLM user simulator. Here, `start()`
discloses its entire original instruction as a customer scenario, including
conditional preferences. Preferences revealed after a question are treated as
already stated, and later changes of mind supersede earlier requests. A clearly
labelled local pre-authorization replaces interactive confirmation. Both domain
policy documents and rules are retained in the prompt; the confirmation waiver
is stated explicitly. These changes remove conversational elicitation and consent
testing. They must not be described as the native tau interaction protocol.

`grade()` reproduces the native full-database terminal hash comparison after
reference replay and its case-insensitive required-output substring check, with
commas removed from the final response. The final response is the sole assistant
response considered. A local nonempty-final check is added. `grade()` uses actual
episode state, does not trust the caller's trace, and does not reset that state.

The reported metric is **local_state_transition_accuracy**, not an official tau
score or pass^k. The tests execute the unchanged upstream `calculate_reward` AST
with inert data holders to cross-check all selected successful reference runs.
Native API quirks are preserved: for example, changing flights does not update
the cabin field, and seat counts are not updated by the native tools. State
matching therefore does not imply every policy or user-facing semantic claim is
correct. No LLM judge is involved, and no judge trust status is changed.

## Data selection and privacy boundary

All 165 test records (115 retail, 50 airline) are preserved in
`private/original_records.jsonl`, including exact original instructions, actions,
outputs and source metadata. Full original `tasks_test.py` files are also retained.
The selected 24 cases store their original record in the contract's private
`case.data`. Gold actions and outputs are available only to grading/reference
code. `start()` emits only the instruction, public policy and tool schemas. Tests
replace private labels/actions with sentinels and verify that `start()` is unchanged.
The runner must send only `Episode.start()` to a model, never serialize `case.data`
or mount private references as model-readable tools.

Selection deduplicates upstream IDs and canonical record SHA256 before sampling,
then uses seed 17 to prioritize action-family and sequence diversity, with a quota
of 12 per domain. Every selected reference causes a real database change, so an
empty run cannot pass. Every exclusion has an ID and reason in `manifest.json`.
The three compensation records excluded on semantic grounds are documented
individually. This targeted subset is not a random or representative sample.

Reference scripts contain known-good actions and answer text. They validate the
harness only; their pass rate is not evidence of agent capability. No models were
called while building or validating this subset.

## Reproduce

From the workspace root:

```bash
python3 -m unittest discover -s host/bots/eval/tests -p 'test_public_tau_bench.py' -v
```

The shared bridge/CLI can replay all 24 cases with no model calls:

```bash
node host/bots/eval/bin/public_eval.mjs run --sources tau_bench --mode reference --max-steps 32 --out /tmp/tau-reference-new
```

Use a new output directory on each run. The longest selected native reference has
20 calls plus a final response, so the CLI's default 16-step cap is too small.

To rebuild from an existing local checkout at the pinned revision (no download or
dependency installation is performed):

```bash
python3 host/bots/eval/public/tau_bench/build_subset.py /path/to/pinned/tau-bench
```

The manifest includes every vendored file SHA256, selected record SHA256, case
file checksum, revision, license evidence, counts and exclusions. The test suite
checks all reference episodes, no-op/wrong results, changed-state rejection,
required outputs, schema errors, bounded arithmetic, transfer termination, state
isolation, source integrity, native reward parity and the private-label boundary.

See `NOTICE` and `LICENSE` for attribution and `AUDIT.md` for the execution audit.
