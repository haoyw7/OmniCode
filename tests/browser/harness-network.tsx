import { TranscriptServices } from "../../src/app/ui/TranscriptServices";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { setUiLanguage } from "../../src/shared/i18n/language";
import type { HostSession } from "../../src/features/connections/model/protocol";
import "../../src/styles/index.css";

const scenario = new URLSearchParams(location.search).get("case") ?? "codex-retrying";
if (!/^(codex|pi|deepseek|antigravity)-(retrying|recovered|failed|continued)$/.test(scenario))
  throw new Error("Unknown network scenario");
setUiLanguage("zh-CN");
document.documentElement.dataset.skin = "daylight";
document.documentElement.dataset.desktopMode = "chat";
document.documentElement.classList.add("theme-light");
const response = await fetch(`/build/harness-network/${scenario}.json`);
if (!response.ok) throw new Error(`Missing network capture: ${scenario}`);
const state: HostSession = await response.json();
createRoot(document.getElementById("root")!).render(<TranscriptServices>{<main style={{ height: "100vh", display: "flex", flexDirection: "column",
    background: "var(--color-app)", color: "var(--color-ink)" }}>
    <header style={{ padding: 16, borderBottom: "1px solid var(--color-hairline)" }}>
      {state.session.harness} · {scenario.split("-").at(-1)} · {state.status}
    </header>
    <AgentTranscript
      harness={state.session.harness}
      blocks={state.session.blocks}
      busy={state.status === "running"}
    />
  </main>}</TranscriptServices>);
