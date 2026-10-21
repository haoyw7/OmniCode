import { UserMessageBlock } from "../../src/features/sessions/ui/transcript/UserMessageBlock";
import { useRef, useState } from "react";
import { WorkFoldLine } from "../../src/features/sessions/ui/transcript/TurnRows";
import { ActivityPhases } from "../../src/features/sessions/ui/transcript/activity/ActivityPhases";
import { PromptOutline } from "../../src/features/sessions/ui/PromptOutline";
import { SessionStatusPanel } from "../../src/features/sessions/ui/SessionStatusPanel";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { Button } from "../../src/shared/ui/forms/Button";
import type { Block } from "../../src/features/sessions/model/session";
import { Slider as SettingsSlider } from "../../src/features/settings/ui/settingsLayout";
import { Checkbox } from "../../src/shared/ui/forms/Checkbox";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { LiveAgentsPreview } from "../../src/features/sessions/ui/LiveAgentsPreview";
import { UnifiedDiffView } from "../../src/features/source-control/ui/UnifiedDiffView";
import { BotRecipientPicker } from "../../src/features/bots/ui/BotRecipientPicker";
import type { BotView } from "../../src/features/bots/model/bots";
import "../../src/features/bots/ui/bots.css";
import "../../src/features/bots/ui/desktop-bot-messenger.css";
import { createRoot } from "react-dom/client";
import { AutomationsView } from "../../src/features/automations/ui/AutomationsView";
import { NotesView } from "../../src/features/notes/ui/NotesView";
import type { Note, NoteUpsert } from "../../src/features/notes/notes";
import { newAutomationDraft, type Automation, type AutomationRun } from "../../src/features/automations/model/automations";
import { setUiLanguage } from "../../src/shared/i18n/language";
import "../../src/styles/index.css";

// Offline real components; no Host, provider or native writes.
setUiLanguage("en");
document.documentElement.dataset.skin = "ripple";
document.documentElement.dataset.desktopMode = "code";
document.documentElement.classList.toggle("theme-light", new URLSearchParams(location.search).get("theme") === "light");
const automation: Automation = {
  ...newAutomationDraft("/fixture/project", "codex", "gpt-5"),
  id: "sample", name: "Daily review", prompt: "Review local changes.",
  nextRunAt: 0, createdAt: 1, updatedAt: 1,
};
const run: AutomationRun = {
  id: "sample-run", automationId: "sample", trigger: "manual", status: "succeeded",
  scheduledFor: 1, createdAt: 1, completedAt: 1001, sessionId: "sample-session",
};
let note: Note = {
  id: "sample-note", title: "Plan", slug: "plan", tags: ["ideas"],
  body: "# Heading\n\nA long source line with enough words to wrap when the panel is narrow. 中文测试。\n\n- Keep alignment",
  sourceCwd: "/fixture/project", createdAt: 1, updatedAt: 1,
};
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
    invoke: async (command: string, args?: { note: NoteUpsert }) => {
      if (command === "plugin:event|listen") return 0;
      if (command === "plugin:event|unlisten") return undefined;
      if (command === "automations_list") return [automation];
      if (command === "automation_runs_list") return [run];
      if (command === "notes_list") return [note];
      if (command === "notes_upsert") { note = { ...note, ...args!.note }; return note; }
      if (/git_branches/.test(command)) return { current: "main", detached: false, branches: [] };
      if (/list|recents|accounts|sessions|notifications/.test(command)) return [];
      if (/available|enabled|running/.test(command)) return false;
      throw new Error(`Offline fixture: ${command}`);
    },
    transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (path: string) => path,
  },
});
const noop = () => {};
function MigratedControls() {
  const [value, setValue] = useState(35), [committed, setCommitted] = useState(35);
  const [checked, setChecked] = useState(false), [sort, setSort] = useState("recent");
  return <section className="flex w-full flex-col gap-4 p-6">
    <SettingsSlider label="Background strength" value={value} display={`${value}%`} min={0} max={100} onChange={setValue} onCommit={setCommitted} />
    <output aria-label="Saved strength">{committed}</output>
    <label className="flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={next => setChecked(next === true)} />Use worktree</label>
    <SearchableSelect label="Sort projects" value={sort} onChange={setSort} searchable={false} options={[{ value: "recent", label: "Recent" }, { value: "name", label: "Name" }]} />
    <LiveAgentsPreview onSelect={noop} agents={Array.from({ length: 6 }, (_, i) => ({ id: `agent-${i}`, cwd: "/fixture/project", title: `Agent ${i + 1}`, harness: "codex", activity: "Done", done: true, needsApproval: false }))} />
    <UserMessageBlock block={{ id: "ci", role: "user", text: "Review the failed check", ciContext: "Checked commit: abc123" }} layout="chat" visible stickyIndex={0} />
    <div className="h-48"><UnifiedDiffView files={[{ id: "sample", path: "sample.ts", label: "sample.ts", additions: 0, deletions: 0, blocks: [], emptyMessage: "No line changes" }]} /></div>
  </section>;
}
const fixtureBots = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }] as BotView[];
function RecipientControls() {
  return <section className="assistant-chat desktop-bots-workspace w-full" data-layout="desktop">
    <BotRecipientPicker open bots={fixtureBots} roomsSupported onChoose={noop} onCreate={noop} onClose={noop} onSend={async () => {}} />
  </section>;
}
const disclosureCommands: Block[] = ["pwd", "git status"].map((command, i) => ({
  id: `command-${i}`, role: "tool", text: command,
  tool: { callId: `command-${i}`, kind: "execute", status: "completed", preview: { kind: "shell", title: command, output: "Completed" } },
}));
const disclosurePrompts: Block[] = [
  { id: "first", role: "user", text: "First request" },
  { id: "first-answer", role: "assistant", text: "First reply" },
  { id: "second", role: "user", text: "Second request" },
  { id: "second-answer", role: "assistant", text: "Second reply" },
];
function DisclosureControls() {
  const scope = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return <div ref={scope} className="@container relative h-full w-full">
    <div className="flex h-full w-[65%] flex-col gap-4 p-6">
      <WorkFoldLine title="Work summary" kind="run" expandable open={open} onToggle={() => setOpen(value => !value)} />
      <div data-disclosure-commands><ActivityPhases blocks={disclosureCommands} done padded={false} /></div>
      <div className="min-h-0 flex-1"><AgentTranscript blocks={disclosurePrompts} busy={false} visible /></div>
      <Button variant="ghost" aria-expanded>Ordinary menu trigger</Button>
    </div>
    <PromptOutline blocks={disclosurePrompts} scope={scope} />
    <SessionStatusPanel blocks={[]} busy={false} git={{ additions: 3, deletions: 1, files: 2, branch: "main" }} cwd="/fixture/project" branch="main" context={{ used: 100, window: 1000 }} scope={scope} onNavigate={noop} />
  </div>;
}
const fixturePage = new URLSearchParams(location.search).get("page");
createRoot(document.getElementById("root")!).render(
  <main className="flex h-screen">
    {fixturePage === "disclosures" ? <DisclosureControls /> : fixturePage === "controls" ? <MigratedControls /> : fixturePage === "bots" ? <RecipientControls /> : fixturePage === "notes"
      ? <NotesView cwd="/fixture/project" recents={[]} onClose={noop} />
      : <AutomationsView cwd="/fixture/project" recents={[]} onClose={noop} onLaunch={noop} onOpenSession={noop} />}
  </main>,
);
