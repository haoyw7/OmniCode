// @vitest-environment happy-dom
import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AgentTranscript } from "../../sessions/ui/AgentTranscript";
import { PooledTranscript, TranscriptPool, TranscriptPoolOutlet } from "../../sessions/ui/TranscriptPool";
import type { Session } from "../../sessions/model/session";
import { rememberRemoteSession } from "../model/connections";
import { rememberRemoteProject } from "../model/remoteProjects";
import type { HostSession } from "../model/protocol";
import { RemoteSession } from "./RemoteSession";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({}),
}));

let root: Root;
let container: HTMLDivElement;
let host: HostSession;
let shell: Session;
let pool: TranscriptPool;
let syncDelay: Promise<void> | undefined;
let caseId = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.clear();
  syncDelay = undefined;
  const project = rememberRemoteProject("pacing-env", {
    id: "project", name: "repo", cwd: "/repo",
  });
  shell = {
    id: "shell", title: "Review", cwd: project.key, harness: "codex",
    model: "codex:test", runtimeMode: "supervised", blocks: [],
  };
  host = {
    projectId: "project", revision: 1, status: "running", updatedAt: 1,
    session: {
      ...shell, id: `history-${++caseId}`, cwd: "/repo", busy: true,
      blocks: [
        { id: "user", role: "user", text: "Review" },
        { id: "reply", role: "assistant", text: "已显示。", streaming: true },
      ],
    },
  };
  rememberRemoteSession(shell.id, host.session.id);
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "remote_machines") return [{
      id: "pacing-machine", name: "Host", endpoint: "http://localhost", environmentId: "pacing-env",
    }];
    if (command === "remote_outbox_list") return [];
    if (command !== "remote_request") return undefined;
    const { method } = input as { method: string };
    if (method === "environment.describe") return {
      protocolVersion: 1, environmentId: "pacing-env", name: "Host", providers: ["codex"], capabilities: [],
    };
    if (method === "models.list") return { models: {}, errors: {} };
    if (method === "sessions.sync") {
      await syncDelay;
      return { kind: "snapshot", value: host };
    }
    throw new Error(`Unexpected request: ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  pool = new TranscriptPool();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

async function show(visible?: boolean) {
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(Fragment, null,
      visible === undefined ? null : createElement(RemoteSession, {
        shell, visible, onOpenFile: () => {}, onOpenDiff: () => {}, onOpenPlan: () => {},
        render: (overrides) => createElement(PooledTranscript, { pool, sessionId: shell.id },
          createElement(AgentTranscript, {
            blocks: overrides.session!.blocks, busy: overrides.session!.busy, visible,
            historyEntries: overrides.transcriptHistory,
          })),
      }),
      createElement(TranscriptPoolOutlet, { pool }),
    ),
  )));
  await settle();
}

it.each(["hidden", "closed"])("shows delayed Host history immediately after a %s desktop tab returns, then shows new output immediately", async (mode) => {
  await show(true);
  expect(container.querySelector(".agent-markdown")?.textContent).toBe("已显示。");
  await show(mode === "hidden" ? false : undefined);
  let release!: () => void;
  syncDelay = new Promise<void>(resolve => { release = resolve; });
  const background = "后台积累的回复，在重新同步后应该直接显示。".repeat(15);
  host = { ...host, revision: 2, session: { ...host.session, blocks: [
    host.session.blocks[0],
    { id: "reply", role: "assistant", text: "已显示。" + background, streaming: true },
    { id: "next", role: "assistant", text: "同步带回的另一条回复。" },
  ] } };
  await show(true);
  expect(container.querySelector(".agent-markdown")?.textContent).toBe("已显示。");
  release();
  await settle();
  expect([...container.querySelectorAll(".agent-markdown")].map(node => node.textContent))
    .toEqual(["已显示。" + background, "同步带回的另一条回复。"]);

  // Later polls are live updates, including new messages completed in one batch.
  syncDelay = undefined;
  const fresh = "接下来新收到的输出依然逐字显示。".repeat(5);
  host = { ...host, revision: 3, session: { ...host.session, blocks: [
    ...host.session.blocks,
    { id: "fresh", role: "assistant", text: fresh },
  ] } };
  await act(async () => vi.advanceTimersByTime(750));
  await settle();
  const replies = () => [...container.querySelectorAll(".agent-markdown")].map(node => node.textContent);
  expect(replies()).toEqual(["已显示。" + background, "同步带回的另一条回复。", fresh]);
});
