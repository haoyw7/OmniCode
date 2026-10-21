import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ArtifactTable } from "../../src/features/workflows/kit/app-shell/workflow-artifacts/presets/ArtifactTable";
import { SavedWorkflowArgsTable } from "../../src/features/workflows/kit/settings/saved-workflows/SavedWorkflowArgsTable";
import { SavedWorkflowRunHistory } from "../../src/features/workflows/kit/settings/saved-workflows/SavedWorkflowRunHistoryPanel";
import type { SavedWorkflowArgRow } from "../../src/features/workflows/kit/settings/saved-workflows/savedWorkflowArgsForm";
import { UsageProviderChip } from "../../src/features/sessions/ui/UsageProviderChip";
import { GitGraphDialog } from "../../src/features/source-control/ui/GitGraphDialog";
import { AutomationsView } from "../../src/features/automations/ui/AutomationsView";
import { newAutomationDraft } from "../../src/features/automations/model/automations";
import { setUiLanguage } from "../../src/shared/i18n/language";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
setUiLanguage("en");
document.documentElement.dataset.skin = params.get("theme") === "light" ? "daylight" : "ripple";
document.documentElement.dataset.desktopMode = "code";
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
const commits = Array.from({ length: 521 }, (_, i) => ({
  sha: `sha-${i}`,
  shortSha: `sha-${i}`,
  subject: `Commit ${i}`,
  author: "Author",
  timestamp: 1700000000 - i,
  parents: i < 520 ? [`sha-${i + 1}`] : [],
  head: i === 0,
  refs: [],
}));
const automation = {
  ...newAutomationDraft("/fixture", "codex", "gpt-5"),
  id: "auto",
  name: "Daily review",
  nextRunAt: 0,
  createdAt: 1,
  updatedAt: 1,
};
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "fixture" },
      currentWebview: { label: "fixture" },
    },
    invoke: async (
      command: string,
      args?: { skip?: number; limit?: number },
    ) => {
      if (command === "plugin:event|listen") return 0;
      if (command === "plugin:event|unlisten") return undefined;
      if (command === "git_history")
        return {
          head: "sha-0",
          commits: commits.slice(
            args?.skip ?? 0,
            (args?.skip ?? 0) + (args?.limit ?? 50),
          ),
        };
      if (/worktree/.test(command)) return { worktrees: [] };
      if (command === "automations_list") return [automation];
      if (command === "automation_runs_list")
        return Array.from({ length: 150 }, (_, i) => ({
          id: `run-${i}`,
          automationId: "auto",
          trigger: "manual",
          status: "succeeded",
          scheduledFor: 1700000000000 - i * 60000,
          createdAt: 1700000000000 - i * 60000,
          startedAt: 1700000000000 - i * 60000,
          completedAt: 1700000000000,
          sessionId: `session-${i}`,
        }));
      if (/git_branches/.test(command))
        return { current: "main", detached: false, branches: [] };
      if (/list|recents|accounts|sessions|notifications/.test(command))
        return [];
      if (/available|enabled|running/.test(command)) return false;
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
    convertFileSrc: (path: string) => path,
  },
});
const spec = {
  title: "Results",
  key: "id",
  columns: [
    { field: "label", label: "Label" },
    { field: "value", label: "Value" },
  ],
};
const items = Array.from({ length: 450 }, (_, i) => ({
  sequence: i,
  siteId: "fixture",
  ordinal: i,
  item: { id: `row-${i}`, label: `Result ${i}`, value: 450 - i },
}));
const labels = {
  empty: "No results",
  otherColumn: "Other",
  itemsCount: (count: number) => `${count} results`,
};
const runs = Array.from({ length: 240 }, (_, i) => ({
  runId: `saved-${i}`,
  status: "completed" as const,
  createdAt: 1700000000000 - i * 1000,
  updatedAt: 1700000001000,
  spentTokens: i,
  parentSessionId: "session",
  toolCallId: i === 0 ? undefined : "tool",
  cwd: "/fixture",
  args: {
    query: `Run ${i}`,
    ...(i % 3 === 0 ? { long: "Long wrapping argument ".repeat(8) } : {}),
  },
  artifacts: [
    {
      id: `artifact-${i}`,
      kind: "table" as const,
      title: `Output ${i}`,
      version: 1,
    },
  ],
}));
function Fixture() {
  const [opened, setOpened] = useState("");
  const [rows, setRows] = useState<SavedWorkflowArgRow[]>([
    {
      key: "one",
      name: "query",
      type: "string",
      required: false,
      defaultText: "",
      description: "",
    },
  ]);
  const mode = params.get("page");
  if (mode === "git")
    return (
      <>
        <output aria-label="Opened">{opened}</output>
        <GitGraphDialog
          cwd="/fixture"
          onClose={() => {}}
          onOpenCommit={(commit) => setOpened(commit.sha)}
        />
      </>
    );
  if (mode === "automations")
    return (
      <div className="flex h-screen">
        <AutomationsView
          recents={[]}
          onClose={() => {}}
          onLaunch={() => {}}
          onOpenSession={setOpened}
        />
        <output aria-label="Opened">{opened}</output>
      </div>
    );
  return (
    <main className="space-y-6 p-6 text-content">
      <ArtifactTable spec={spec} items={items} labels={labels} />
      <SavedWorkflowArgsTable
        rows={rows}
        errors={rows[0]?.name === "duplicate" ? { one: "duplicate_name" } : {}}
        onChange={(key, patch) =>
          setRows((current) =>
            current.map((row) =>
              row.key === key ? { ...row, ...patch } : row,
            ),
          )
        }
        onAdd={() =>
          setRows((current) => [
            ...current,
            {
              key: `arg-${current.length}`,
              name: "new",
              type: "boolean",
              required: false,
              defaultText: "",
              description: "",
            },
          ])
        }
        onRemove={(key) =>
          setRows((current) => current.filter((row) => row.key !== key))
        }
      />
      <SavedWorkflowRunHistory
        runs={runs}
        now={1700000002000}
        canOpenRun
        onOpenRun={(run) => setOpened(run.runId)}
        onOpenArtifact={(_, id) => setOpened(id)}
      />
      <div className="flex w-64">
        <UsageProviderChip
          now={1700000000000}
          limits={{
            provider: "codex",
            session: {
              usedPercent: 42,
              windowMinutes: 300,
              resetsAt: 1700007200000,
            },
            weekly: {
              usedPercent: 81,
              windowMinutes: 10080,
              resetsAt: 1700600000000,
            },
            monthly: null,
            updatedAt: 1700000000000,
            status: "ok",
            error: null,
          }}
        />
      </div>
      <output aria-label="Opened">{opened}</output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
