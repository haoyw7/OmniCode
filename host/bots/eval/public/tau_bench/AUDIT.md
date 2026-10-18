# Offline execution audit

Audited source: Sierra tau-bench revision
`59a200c6d575d595120f1cb70fea53cef0632f6b`. The manifest gives byte-level SHA256
for every retained file. The source checkout revision was checked with
`git rev-parse HEAD` before extraction. No model or provider installation ran.

All native `invoke` bodies in both domain tool directories were reviewed.
They import only typing/json/copy plus the abstract `Tool` base. Lookup tools
read dictionaries. Mutation tools change only the passed dictionaries/lists and
return JSON or status strings. Booking/certificates use fixed simulated IDs;
there are no real purchases, payment connections, emails, or transfers.
`transfer_to_human_agents` only returns `Transfer successful`.

The exception is `calculate`, whose restricted-character `eval` can still accept
expensive arithmetic such as chained exponentiation. The adapter removes that
method from the source AST before compiling the class. The replacement accepts
numeric constants, parentheses, unary signs, +, -, *, /, and //, with at most
256 characters, 64 AST nodes and magnitude 1e12. Exponentiation and nonnumeric
code are rejected. No Pydantic is needed: task constructor records are extracted
using a constrained AST decoder, never imported or executed.

The upstream `Env` class and model/simulator modules are never imported at
runtime. The adapter reads only the vendored fixtures, policy, schema/tool files
and selected case file. It opens no network connections, reads no environment
variables or credentials, invokes no shell commands, and writes no runtime files.
The optional build script uses `git rev-parse HEAD` against the provided local
checkout, copies public source files and writes only this source-specific folder.

Per-call JSON-schema checks are enforced even outside the central runner.
Only known schemas may dispatch native tools; `data` cannot be passed by a
caller. State and tool arguments are copied so that callers, episodes and the
cached initial fixture do not share mutable objects. Error responses leave state
unchanged. A human transfer terminates subsequent tool access. Tool request-ID
retry deduplication is the central bridge's responsibility under ADAPTER_CONTRACT.

The original reward's full database hash and required-output comparison are
ported without model judging. Tests additionally execute the original reward
method AST without its provider imports. Full database comparison detects any
extra mutation, including changes outside the intended user's records. It does
not check action order, consent or conversational quality, nor does it correct
known flaws in the legacy tool logic. Three original compensation cases are
excluded because their reference action conflicts with the explicit delay
compensation policy and/or needs conversational timing. Remaining successful
native-reference replay is a harness check, not a comprehensive semantic audit.

`private/` is a harness boundary, not filesystem access control: the central
runner must never expose case data or reference files to the evaluated model.
`start()` itself emits no gold actions, expected output list or hidden user ID
field. The verbatim user scenario, policy, and tool schema examples are intended
model-visible source context. The test suite verifies this boundary by replacing
private gold fields with sentinel values and comparing the complete start result.
