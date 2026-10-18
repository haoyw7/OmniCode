import { applyDesktopSkin } from "../../src/shared/theme/desktopSkin";
// Synthetic, offline data. No provider/Host calls or reference-app conversations.
import { useState } from "react";
import { BotMemoryDialog } from "../../src/features/bots/ui/BotMemoryDialog";
import { createRoot } from "react-dom/client";
import { DesktopBotsWorkspace } from "../../src/features/bots/ui/DesktopBotsWorkspace";
import { fullBotPolicy, type BotMessage } from "../../src/features/bots/model/botView";
import type { BotView, BotThread } from "../../src/features/bots/model/bots";
import type { BotRpc } from "../../src/features/bots/model/botRpc";
import { setUiLanguage } from "../../src/shared/i18n/language";
import "../../src/styles/index.css";
setUiLanguage("en");
applyDesktopSkin();
const query = new URLSearchParams(location.search);
const now = Date.UTC(2026, 9, 12, 12);
const bots: BotView[] = Array.from({ length: 60 }, (_, i) => ({
  id: `demo-${i}`, name: i ? `Project assistant ${i}` : "MonoCode", defaultThreadId: `thread-${i}`,
  createdAt: now, updatedAt: now, revision: 1, chatRevision: 6, lifecycle: query.has("running") ? "running" : "idle", enabled: true,
  harness: "codex", model: "default", modelSettings: {}, runtimeMode: "full-access", targetRuntimeMode: "full-access",
  policy: fullBotPolicy(), policyVersion: 1, triggers: { user: true, event: false, schedule: false },
  schedules: [], watches: [], maxAutoTurns: 8, chainWindowMinutes: 15, brainGeneration: 1,
}));
const threads: BotThread[] = bots.map((bot, i) => ({ botId: bot.id, id: bot.defaultThreadId, title: i ? "Planning" : "Interface review", kind: "direct", createdAt: now, updatedAt: now, revision: 1, lifecycle: "idle", chatRevision: 6 }));
let revision = 6;
let entries: BotMessage[] = [
 { id: "1", kind: "user", text: "请检查新的桌面界面。Keep the text clear and preserve keyboard navigation.", revision: 1, createdAt: now },
 { id: "2", kind: "assistant", text: "已完成布局检查。\n\n- 保留 **MonoCode** 品牌和现有能力\n- 检查长文本、代码块和工具结果\n- 使用键盘打开设置，再返回对话", revision: 2, createdAt: now + 1000 },
 { id: "3", kind: "assistant", text: "```typescript\nconst viewport = { width: 1280, height: 800 };\nconst title = 'A deliberately long line to verify horizontal scrolling without moving the conversation viewport';\n```", revision: 3, createdAt: now + 2000 },
 { id: "4", kind: "session-card", title: "Codex: Review layout", harness: "codex", model: "default", projectName: "monocode", actionId: "demo", status: "completed", ref: { projectId: "demo", sessionId: "demo", environmentId: "demo" }, revision: 4, createdAt: now + 3000 },
 { id: "5", kind: "assistant", text: "工具检查完成。布局和交互结果可以在设置面板中查看。", revision: 5, createdAt: now + 4000 },
 { id: "6", kind: "user", text: "Thanks. Please keep the existing conversation and cancellation controls.", revision: 6, createdAt: now + 5000 },
];
const view = (id: string) => { const thread = threads.find(t => t.id === id) ?? threads[0]; return { ...bots.find(b => b.id === thread.botId)!, botId: thread.botId, threadId: id, title: thread.title, chatRevision: revision }; };
const rpc: BotRpc = async (method, params = {}) => {
 const p = params as Record<string, any>;
 if (method === "environment.describe") return { capabilities: ["assistant.v1", "assistant.history", "bots.shell.v1", "bots.v1", "bots.management.v1"] } as never;
 if (method === "bots.list") return { revision: 1, bots, threads, defaultBotId: bots[0].id, defaultThreadId: threads[0].id } as never;
 if (method === "botThreads.get") return view(p.threadId) as never;
 if (method === "botThreads.messages") return { assistant: view(p.threadId), entries: p.threadId !== "thread-0" ? [] : p.latest ? entries.slice(-p.limit) : entries.filter(m => m.revision > (p.afterRevision ?? 0)), nextRevision: revision, hasMore: false } as never;
 if (method === "models.list") return { models: { codex: [{ id: "default", name: "Default" }] }, errors: {} } as never;
 if (method === "projects.list") return [] as never;
 if (method === "botThreads.control") return { accepted: true } as never;
 if (method === "botThreads.send") { if (query.has("error")) throw new Error("Synthetic offline delivery failure"); entries = [...entries, { id: `sent-${++revision}`, kind: "user", text: p.text, revision, createdAt: now + revision * 1000 }]; return { accepted: true } as never; }
 if (method === "botThreads.cancel") return { accepted: true } as never;
 throw new Error(`Offline fixture: ${method}`);
};
Object.assign(window, {
 botsFixture: {
  long() { entries = Array.from({ length: 180 }, (_, i) => ({ id: `long-${i}`, kind: i % 3 ? "assistant" : "user", text: `Message ${i}: ` + "清晰的文字与稳定的滚动。 ".repeat(35) + (i % 5 ? "" : "\n```ts\nconst example = 'code block';\n```"), revision: ++revision, createdAt: now + i * 1000 })); },
  stream() { let n = 0; const id = `stream-${revision}`; entries = [...entries, { id, kind: "assistant", text: "Streaming", streaming: true, revision: ++revision, createdAt: now + 200000 }]; const timer = setInterval(() => { entries = entries.map(m => m.id === id ? { ...m, text: "Streaming " + "稳定更新文本。 ".repeat(++n), streaming: n < 50, revision: ++revision } as BotMessage : m); if (n >= 50) clearInterval(timer); }, 60); },
 }
});
function MemoryFixture() {
 const [open, setOpen] = useState(true);
 return <BotMemoryDialog open={open} text="Synthetic remembered preference" meta="Offline dialog verification" busy={false} error="Synthetic validation error" onClose={() => setOpen(false)} onSave={() => setOpen(false)} onForget={() => setOpen(false)} />;
}
createRoot(document.getElementById("root")!).render(<div style={{ height: "100vh", display: "flex", containerType: "inline-size" }}>{query.has("modal") && <MemoryFixture />}<DesktopBotsWorkspace hostKey="rea-offline" hostName="Local workspace" rpc={rpc} onOpen={() => {}} desktopBots /></div>);
