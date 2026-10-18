import { setUiLanguage } from "../../src/shared/i18n/language";
import { MobileComposer } from "../../src/mobile/MobileComposer";
import { IconButton } from "../../src/shared/ui/forms/IconButton";
// Real conversation and drawer, with local data for visual inspection only.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MobileConversation } from "../../src/mobile/MobileConversation";
import { MobileDrawer } from "../../src/mobile/MobileDrawer";
import { MobileEmpty } from "../../src/mobile/MobileEmpty";
import { BotMessages } from "../../src/features/bots/ui/BotMessages";
import { TranscriptPlatformContext } from "../../src/features/sessions/ui/TranscriptPlatform";
import { mobileTranscriptPlatform } from "../../src/mobile/transcriptPlatform";
import { applyMobileSkin } from "../../src/mobile/theme/skin";
import { PanelLeft, MoreHorizontal, Plus, Sparkles } from "../../src/shared/ui/icons";
import type { Block } from "../../src/features/sessions/model/session";
import "../../src/mobile/theme/index.css";
import "../../src/mobile/styles/index.css";
import "../../src/mobile/motion.css";

const query = new URLSearchParams(location.search);
if (query.has("assistant")) {
  await import("../../src/features/bots/ui/bots.css");
  await import("../../src/mobile/styles/assistant.css");
}
setUiLanguage("zh-CN");
applyMobileSkin(query.get("theme") === "dark" ? "midnight" : "daylight");
const project = { id: "project", name: "Monocode", cwd: "/fixture" };
const noop = () => {};
const blocks: Block[] = [
  { id: "prompt", role: "user", text: "You're a tiny fairy who lives in a teapot. Describe your cozy home and your daily adventures in the kitchen!", startedAt: 1000, durationMs: 4000 },
  { id: "answer", role: "assistant", text: "*Tink tink!* Oh, hello there, big world! I'm Pippa, a teapot fairy, and welcome to my itty-bitty abode!\n\nMy home is a lovely old porcelain teapot with hand-painted bluebells. The spout is my front door, and I've hung tiny wind chimes made from lost earrings there. Inside, I've lined the walls with velvety rose petals for insulation.\n\nOh! I hear the kettle whistling — time to hide! Being a teapot fairy is always exciting, but it's important to keep the magic a secret. *Wink!*" },
];
if (query.has("footer")) blocks.splice(0, blocks.length,
  { id: "prompt", role: "user", text: "重新构建移动端，发布局域网", startedAt: 1000, durationMs: 55000,
    turnModel: { harness: "codex", id: "gpt-6-astra", name: "GPT-6-Astra" },
    turnMetrics: { inputTokens: 1200, outputTokens: 180 } },
  { id: "answer", role: "assistant", text: "- [下载 APK](http://example.test/app.apk)\n\n可在应用内检查更新。" },
);
if (query.has("long")) blocks.push(
  { id: "long-prompt", role: "user", text: "检查这个长路径：" + "very-long-directory-name/".repeat(12), startedAt: 6000, durationMs: 1000 },
  { id: "long-answer", role: "assistant", text: "中文回复也应保持舒适的阅读节奏，长路径与代码在手机宽度内展示。\n\n```ts\nconst path = '" + "long-segment/".repeat(20) + "';\n```\n\n| 名称 | 内容 |\n| --- | --- |\n| 路径 | `" + "segment/".repeat(20) + "` |" },
);

function Fixture() {
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState(query.has("drawer"));
  const [empty, setEmpty] = useState(query.has("empty"));
  return <div className="mobile-app" data-view="chat">
    <header className="mobile-header" data-floating="true" inert={drawer}>
      <IconButton className="" label="Menu" onClick={() => setDrawer(true)}><PanelLeft size={22} /></IconButton>
      <div className="mobile-header-title" data-capsule="true"><strong>Tiny Fairy Story</strong><div className="mobile-header-context"><span className="mobile-header-context-item"><span>Monocode</span></span></div></div>
      {empty ? <IconButton className="" label="New conversation" onClick={() => setEmpty(false)}><Plus size={22} /></IconButton> :
        <div className="mobile-header-actions">
          <IconButton className="" label="Status"><Sparkles size={22} /></IconButton>
          <IconButton className="" label="Session actions"><MoreHorizontal size={22} /></IconButton>
        </div>}
    </header>
    <main className="mobile-chat" data-new-conversation={empty} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {empty ? <MobileEmpty icon={<Sparkles />} title="What shall we create today?" /> : query.has("assistant") ?
        <div className="assistant-chat" data-layout="mobile"><div className="assistant-messages">
          <BotMessages messages={blocks.map((block, index) => ({ id: block.id, kind: block.role === "user" ? "user" : "assistant", text: block.text, createdAt: 1000 + index, revision: index }))}
            mobile busy={false} canRead onOpen={noop} onRespond={noop} bindReply={() => ({})} />
        </div></div> :
        <TranscriptPlatformContext.Provider value={query.has("footer") ? { ...mobileTranscriptPlatform, liveClockInFooter: true } : mobileTranscriptPlatform}>
          <MobileConversation blocks={blocks} harness="claude" hapticsActive={false} onSaveNote={query.has("footer") ? undefined : noop} />
        </TranscriptPlatformContext.Provider>}
      <MobileComposer value={draft} onChange={setDraft}
        configuration={{ harness: "claude", model: "claude-sonnet", modelSettings: {}, runtimeMode: "supervised" }}
        onConfigurationChange={noop} lockedAgent={false} disabled={false} running={false}
        canSend={!!draft} canStop={false} working={false} onSend={() => setDraft("")} onStop={noop}
        panel={null} onPanelChange={noop} projects={[]} onProjectChange={noop}
        attachments={[]} onFiles={noop} onRemoveAttachment={noop} planMode={false} onPlanModeChange={noop} />
    </main>
    <MobileDrawer open={drawer} onOpenChange={setDrawer} projects={[project]} project={project}
      sessions={["Tiny Fairy Story", "A very long conversation title that must fit on a narrow phone screen", "调试移动端的样式"].map((title, index) => ({ id: String(index), projectId: project.id, title, harness: index === 1 ? "codex" : "claude", status: "idle", revision: 1, updatedAt: 100 - index }))}
      sessionId="0" unreadIds={new Set(["1"])} now={100} loading={false}
      hostName="My computer" hostStatus={{ state: "connected" }} loadSessions={async () => []}
      onHome={() => setDrawer(false)} onAllProjects={noop} onSession={() => setDrawer(false)}
      onSessionActions={noop} onNewSession={() => { setEmpty(true); setDrawer(false); }} onSettings={noop} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
