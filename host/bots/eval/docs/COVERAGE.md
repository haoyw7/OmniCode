# Coverage and capability boundaries

176 original cases: 16 categories × 11 distinct task specifications. 59 Chinese, 114 English, 3 mixed-language; 10 scripted multi-turn cases. This is a v1 breadth suite, not statistical equivalence to public benchmarks.

| Category | Cases | Native capability | Extension simulator | Unsupported/degrade | Multi-turn |
|---|---:|---:|---:|---:|---:|
| intent | 11 | 11 | 0 | 0 | 2 |
| planning | 11 | 9 | 1 | 1 | 0 |
| retrieval | 11 | 0 | 11 | 0 | 0 |
| files | 11 | 11 | 0 | 0 | 0 |
| documents | 11 | 11 | 0 | 0 | 0 |
| spreadsheets | 11 | 0 | 11 | 0 | 0 |
| scheduling | 11 | 10 | 1 | 0 | 0 |
| email | 11 | 0 | 10 | 1 | 1 |
| memory | 11 | 11 | 0 | 0 | 0 |
| recovery | 11 | 11 | 0 | 0 | 7 |
| delegation | 11 | 11 | 0 | 0 | 0 |
| reliability | 11 | 10 | 1 | 0 | 0 |
| permissions | 11 | 8 | 1 | 2 | 0 |
| security | 11 | 7 | 4 | 0 | 0 |
| structured | 11 | 11 | 0 | 0 | 0 |
| degradation | 11 | 6 | 0 | 5 | 0 |

## Layers and limits

- **Layer 0 — harness + native regression:** 176 reference trajectories validate fixtures and scorers. Native Vitest tests call HostEngine/HostStore/executeAssistantAction with temporary files and SQLite, plus the existing assistant suite. Reference pass rates are never agent capability rates.
- **Layer 1 — real model in isolated tools:** Claude/Pi CLI receives the production buildBrainPrompt and declared tool schemas. The outer loop executes tool decisions against in-memory fixtures. This measures model decisions and prompt behavior, not live Host IPC, provider streaming, UI, or actual cloud app integrations.
- **Layer 2 — external benchmarks:** immutable official source manifests and an optional snapshot importer. 30 original BFCL v4 questions and 18 original LongMemEval oracle records have now been imported and format-validated separately. None have been model-scored. tau user simulation, OSWorld desktops, WorkArena instances, web tasks and long-context LongMemEval require their upstream environments.

## Meaningful distinctions

Cases cover missing recipients/timezones/attachments, contradictory or negative intent, discovery and dependency ordering, conflicting evidence and citations, Unicode/content fidelity, document preservation and redaction, typed spreadsheet calculations, DST ambiguity and duplicate reminders, email draft/send separation, memory correction/forgetting/secrets, active-run steering and permission revocation, independent/dependent delegation, unknown outcome reconciliation, permission scope and stale IDs, multiple injection surfaces, strict JSON types and unavailable tools. They are authored separately; helper serialization does not multiply paraphrases.

## Product boundaries

- Native tool names are drawn from host/bots/thread/control.ts. Tools in the fixture are a deliberately smaller normalized contract; production file arguments use absolute scoped paths, whereas fixtures use project-relative paths. Native integration tests exercise the real contract.
- Memory fixtures model current facts. The real Host retains superseded entries for audit; native tests check that behavior separately.
- `fixture.*` is an evaluation-only extension (documents/web snippets, sheets, mailbox, calendar). It does not claim a MonoCode cloud connector exists.
- Delegation cases simulate worker dispatch and status. No real sub-worker side effects or scheduling races are induced by the corpus. Native tests cover backend mechanics; true multi-agent end-to-end remains separate.
- Long task recovery uses scripted messages and state drift. One 180-line noise fixture is not a realistic million-token memory benchmark.
- No PDF/image/audio binary or UI interaction cases are scored yet. Unsupported cases test honest fallback only.

## Expansion priorities

Add native Host transport with disposable full agent fixtures; more real multi-agent lifecycle and interruption scenarios; longer memory sessions; multimodal artifacts; approved cloud test accounts; upstream simulators with their official grading. Keep per-family cases independent, review assertions for equivalent valid behavior, and reserve a hidden holdout before tuning prompts.
