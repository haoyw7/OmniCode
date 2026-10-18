# BFCL: local strict call-set subset

30 distinct upstream BFCL v4 records, six each from `simple_python`, `multiple`,
`parallel`, `parallel_multiple`, and `irrelevance`. Revision and original line
checksums are recorded in `manifest.json` and each case. The immutable imported
questions and candidate answers remain in `../../data/upstream/bfcl-v4-sample`.
Source selection is the prior fixed evenly spaced sample, not another random
draw; the adapter verifies both IDs and hashes before producing one variant per
record. Original records are also retained without field edits in private `data`.

This is **not an official BFCL score**. The local checker validates closed JSON
schemas, requires exact upstream candidate values, and matches the unordered
multiset of actual calls using bipartite matching. Duplicate, missing, extra,
invalid-type, and unknown calls fail. Integer parameters reject booleans and
floats; number parameters permit integers and finite floats. Nested candidate
dictionaries are handled recursively. Argument arrays preserve ordering unless
upstream provides another ordering explicitly. Empty-string candidates mean a
parameter may be omitted, not that an empty string should be passed. This is
stricter than some official AST normalizations.

`start()` contains only the upstream question and schemas plus local protocol
instructions. Hidden alternatives are used only by `grade()` and `reference()`.
Original function names, including dots, are retained. BFCL Python `dict` and
`float` types become JSON `object` and `number`. Calls create in-memory receipts
only: no function implementation is run and no function result is invented.
The six irrelevance cases require zero calls. Final response semantics are not
graded; only nonempty final text is required.

Rebuild: `python3 host/bots/eval/public/bfcl/build_subset.py`.
Validate with `python3 -m unittest discover -s host/bots/eval/tests -p test_public_memory_calls.py`.
Reference scripts validate harness/scorer plumbing, not agent capability.
Runtime uses only Python standard library; no model, provider, network, secrets,
or production service is touched. Each fresh `Episode` resets all state.

Source: [BFCL repository](https://github.com/ShishirPatil/gorilla/tree/6ea57973c7a6097fd7c5915698c54c17c5b1b6c8/berkeley-function-call-leaderboard).
Apache-2.0 code license is copied in `LICENSE`; dataset license attribution is in
`NOTICE` and the manifest. No official evaluator code is vendored or executed.
