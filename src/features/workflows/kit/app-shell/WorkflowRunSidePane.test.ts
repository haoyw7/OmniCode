// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowRunSidePane } from "./WorkflowRunSidePane";
import type { WorkflowRunSidePaneTab } from "../lib/workspaceSidePane";
import { workflowRequest } from "../../model/workflowClient";
import { TooltipProvider } from "../../../../shared/ui/primitives/Tooltip";
import { WorkflowArtifactTabView, WorkflowRunTabView } from "../../ui/WorkflowTabs";
import { WorkflowAppContext, type WorkflowAppActions } from "../../ui/workflowAppContext";
import { newWorkflowArtifactTab, newWorkflowRunTab, isWorkflowArtifactTab, isWorkflowRunTab } from "../../../workspace/model/layout";
import { remoteProjectFor } from "../../../connections/model/remoteProjects";
import { revealPath } from "../../../../platform/tauri/fs";

vi.mock("../../../connections/model/remoteProjects", async importOriginal => ({
  ...await importOriginal<typeof import("../../../connections/model/remoteProjects")>(),
  remoteProjectFor: vi.fn(),
}));
vi.mock("../../../../platform/tauri/fs", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../platform/tauri/fs")>(),
  revealPath: vi.fn(async () => {}),
}));

vi.mock("../../model/workflowClient", () => ({ workflowRequest: vi.fn() }));
vi.mock("../../model/workflowSessionWatch", () => ({
  watchHostSession: (_cwd: string, sessionId: string) => ({
    sessionId, getSnapshot: () => undefined, subscribe: () => () => {},
    refresh: () => {}, release: () => {}, approve: async () => {},
  }),
}));

const tab: WorkflowRunSidePaneTab = {
  id: "tab", type: "workflow-run", workspaceKey: "/repo", workspacePath: "/repo",
  parentSessionId: "parent", toolCallId: "tool", runId: "run",
};
const documentText = `# Daily report\n\n${"Report content. ".repeat(180)}\n\nFinal paragraph beyond the thumbnail.`;
const storedPath = "/custom-host/workflow-artifacts/parent/report.md";
const artifacts = [
  { id: "report", kind: "file", title: "Daily report", contentType: "text/markdown",
    sourcePath: "reports/daily.md", version: 1, primary: true, itemCount: 0,
    versions: [{ version: 1, bytes: documentText.length }] },
  { id: "board", kind: "board", title: "Progress", version: 1, versions: [], itemCount: 1,
    spec: { key: "id", status: "status", columns: ["Done"], cardTitle: "title" } },
];

describe("workflow artifact opening", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(remoteProjectFor).mockReturnValue(undefined);
    vi.mocked(revealPath).mockResolvedValue(undefined);
    vi.mocked(workflowRequest).mockImplementation(async (_cwd, method) => {
      if (method === "artifacts") return { artifacts };
      if (method === "artifactRead") return {
        dataBase64: btoa(documentText), mediaType: "text/markdown", totalBytes: documentText.length, nextOffset: null, storedPath,
      };
      if (method === "artifactData") return {
        items: [{ sequence: 1, siteId: "news", ordinal: 1, item: { id: "story", status: "Done", title: "Story checked" } }],
        hasMore: false,
      };
      throw new Error(`Unexpected request: ${method}`);
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function open(artifactId: string) {
    const button = container.querySelector<HTMLButtonElement>(`button[data-artifact-id="${artifactId}"]`)!;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
  }

  async function render(props: ComponentProps<typeof WorkflowRunSidePane>) {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(WorkflowRunSidePane, props))));
  }

  async function renderArtifact(request: Parameters<WorkflowAppActions["openArtifact"]>[0]) {
    const { cwd, title, sourceFileId: _source, ...source } = request;
    const file = newWorkflowArtifactTab(title ?? source.artifactId, cwd, source);
    if (!isWorkflowArtifactTab(file)) throw new Error("Expected artifact tab");
    await act(async () => root.render(createElement(WorkflowArtifactTabView, { file })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    return container.querySelector("[data-workflow-artifact-tab]")!;
  }

  it("opens the document and board through the workspace tab action", async () => {
    const openArtifact = vi.fn<WorkflowAppActions["openArtifact"]>();
    const app: WorkflowAppActions = { openArtifact, openRun: vi.fn(), openAgent: vi.fn(),
      openSession: vi.fn(), createViaChat: vi.fn() };
    const file = newWorkflowRunTab("Run", "/repo", { parentSessionId: "parent", runId: "run", toolCallId: "tool" });
    if (!isWorkflowRunTab(file)) throw new Error("Expected run tab");
    const renderRun = async () => {
      await act(async () => root.render(createElement(WorkflowAppContext.Provider, { value: app },
        createElement(WorkflowRunTabView, { file }))));
    };
    await renderRun();
    expect(container.textContent).not.toContain("Final paragraph beyond the thumbnail.");
    await open("report");
    expect(openArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      artifactId: "report", parentSessionId: "parent", runId: "run", cwd: "/repo", sourceFileId: file.id,
    }));
    const documentTab = await renderArtifact(openArtifact.mock.calls.at(-1)![0]);
    expect(documentTab.textContent).toContain("Final paragraph beyond the thumbnail.");
    expect(workflowRequest).toHaveBeenCalledWith("/repo", "artifactRead", expect.objectContaining({ runId: "run", artifactId: "report", version: 1 }));
    await renderRun();
    await open("board");
    const board = await renderArtifact(openArtifact.mock.calls.at(-1)![0]);
    expect(board.textContent).toContain("Story checked");
    expect(board.textContent).not.toContain("Final paragraph beyond the thumbnail.");
  });

  it("preserves a host-provided artifact opener and its workspace identity", async () => {
    const onOpenWorkflowArtifact = vi.fn();
    await render({ tab, onOpenWorkflowArtifact });
    await open("report");
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith({
      workspacePath: "/repo", parentSessionId: "parent", runId: "run", artifactId: "report",
      title: "Daily report", kind: "file", contentType: "text/markdown", sourcePath: "reports/daily.md",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("reveals the stored local copy instead of the workspace source, and reports failures", async () => {
    vi.mocked(remoteProjectFor).mockReturnValue({ key: "/repo", cwd: "/repo", environmentId: "local", projectId: "project", local: true });
    await renderArtifact({ cwd: "/repo", parentSessionId: "parent", runId: "run", artifactId: "report" });
    expect(container.textContent).toContain("Saved on this computer");
    expect(container.textContent).toContain(storedPath);
    const reveal = [...container.querySelectorAll("button")].find(button => button.textContent === "Show in folder")!;
    expect(reveal).toBeDefined();
    await act(async () => reveal.click());
    expect(revealPath).toHaveBeenCalledWith(storedPath);
    vi.mocked(revealPath).mockRejectedValueOnce(new Error("File was removed"));
    await act(async () => reveal.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("File was removed");
    expect(reveal.disabled).toBe(false);
  });

  it("labels remote storage and does not offer local reveal", async () => {
    vi.mocked(remoteProjectFor).mockReturnValue({ key: "/repo", cwd: "/repo", environmentId: "remote", projectId: "project" });
    await renderArtifact({ cwd: "/repo", parentSessionId: "parent", runId: "run", artifactId: "report" });
    expect(container.textContent).toContain("Saved on Host");
    expect(container.textContent).toContain(storedPath);
    expect(container.textContent).not.toContain("Show in folder");
    expect(revealPath).not.toHaveBeenCalled();
  });

  it("keeps preview and export available with an older Host that omits the stored path", async () => {
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return "blob:artifact"; }
      static revokeObjectURL() {}
    });
    vi.mocked(workflowRequest).mockImplementation(async (_cwd, method) => {
      if (method === "artifacts") return { artifacts };
      return { dataBase64: btoa(documentText), mediaType: "text/markdown", totalBytes: documentText.length, nextOffset: null };
    });
    await renderArtifact({ cwd: "/repo", parentSessionId: "parent", runId: "run", artifactId: "report" });
    const save = container.querySelector<HTMLAnchorElement>("a[download]")!;
    expect(save.textContent).toBe("Save as…");
    expect(save.download).toBe("daily.md");
    expect(container.textContent).toContain("Final paragraph beyond the thumbnail.");
    expect(container.textContent).not.toContain("Saved on");
    expect(container.textContent).not.toContain("Show in folder");
  });

  it("shows read failures instead of leaving the viewer loading", async () => {
    vi.mocked(workflowRequest).mockImplementation(async (_cwd, method) => {
      if (method === "artifacts") return { artifacts };
      throw new Error("Artifact read failed");
    });
    const view = await renderArtifact({ cwd: "/repo", parentSessionId: "parent", runId: "run", artifactId: "report" });
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("Artifact read failed");
    expect(view.querySelector('[role="status"]')).toBeNull();
  });
});
