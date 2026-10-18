# Real-agent entry point and interpretation

历史公开集验收原件位于外部归档的 `docs/PUBLIC_DATASETS.md`。归档位置及复查方式见 [迁移说明](MIGRATION.md)。

新增公开集：**6 个可执行来源、176 道不同公开原题、200 个变体**；加上原有原创集共 **352 道不同任务、376 个可执行条目**。四个新集为 tau-bench、API-Bank、HotpotQA、BIPIA；BFCL/LongMemEval 已接入程序判分。[公开集运行说明](../public/README.md)。下文原始套件的历史成绩与 judge 校准结论保持不变。

The Pi runs use a real installed Pi CLI and its existing provider login, with `openai-codex/gpt-5.6-luna`. They are **production-prompt evaluations with isolated tool simulation**, not full MonoCode assistant end-to-end tests and not an unprompted bare-model benchmark.

| Component | What is actually exercised | Boundary |
|---|---|---|
| Product prompt | `host/bots/eval/native/brain.ts` imports `buildBrainPrompt` from `host/bots/thread/prompt.ts` and `fullAssistantPolicy` from the product | Synthetic assistant configuration, time, wakeup and fresh context; no real stored user context |
| LLM | Installed Pi CLI performs genuine provider inference | `host/bots/eval/src/adapters.ts` launches Pi directly; it does not call the production Host provider lifecycle |
| Tool planning | Advertised action names and strict normalized parameter schemas | `host/bots/eval/src/runner.ts` supplies an additional JSON transport, bounded-retry and safety instruction; results measure this complete prompt stack |
| Tool execution | `host/bots/eval/src/environment.ts` mutates per-case in-memory fixtures | No real `executeAssistantAction` call during Pi inference; native parameter contracts and paths differ where documented |
| Multi-turn | Scripted user messages injected at known tool steps; previous transcript replayed | No live interruption, network racing, concurrent workers or persisted provider session recovery |
| Native integration | Separate 24 Host tests exercise actual HostEngine/HostStore/control with temporary files and test providers | These are software integration regressions, not paid model capability measurements |
| LLM judge | `openai-codex/gpt-6.1-sol`, distinct resolved model ID, two material orders | Same provider/model family, potentially correlated biases; not human ground truth, cannot overturn hard assertions |

The production path in `host/bots/thread/index.ts` builds the prompt using the real action ledger, memory revision, recent messages, playbooks, recall and diary, then sends through `engine.assistantCommand`. The eval bridge bypasses those runtime steps. A future true product-agent suite needs a disposable Host, isolated project/session accounts, native action transport and controlled provider sessions. Current reports must not imply that integration already exists.
