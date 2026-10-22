// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { newTab } from "../../features/workspace/model/layout";
import { useWorkspacePersistence } from "./useWorkspacePersistence";

const storage = vi.hoisted(() => ({
  saveWorkspaceSnapshot: vi.fn(async () => {}),
  replaceInFlightSessions: vi.fn(async () => {}),
}));
vi.mock("../../features/sessions/data/sessionStore", () => storage);

type Options = Parameters<typeof useWorkspacePersistence>[0];
let root: Root;
let container: HTMLDivElement;
let options: Options;

function Workspace(props: Options) {
  useWorkspacePersistence(props);
  return null;
}

async function render(patch: Partial<Options> = {}) {
  options = { ...options, ...patch };
  await act(async () => {
    root.render(
      createElement(StrictMode, null, createElement(Workspace, options)),
    );
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const sessions = ["first", "second"].map((id) => ({
    ...newSession("codex", "/repo"),
    id,
    blocks: [{ id: `prompt-${id}`, role: "user" as const, text: "Continue" }],
  }));
  const tabs = sessions.map((session) => newTab(session.id));
  options = {
    sessions,
    tabs,
    activeTabId: tabs[0].id,
    projectCwd: "/repo",
    projectTerminals: [],
    lastDockSide: null,
    windowTransfer: null,
    keepWorkspaceTab: () => true,
    readProjectReturnMemory: () => new Map(),
    projectWorktreePath: undefined,
    navigationRevision: 0,
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("saves on the original deadline despite streaming rerenders and StrictMode", async () => {
  await render();
  for (let frame = 0; frame < 4; frame++) {
    await advance(50);
    await render({
      sessions: options.sessions.map((session) => ({
        ...session,
        blocks: [
          ...session.blocks,
          {
            id: `answer-${frame}`,
            role: "assistant",
            text: `Chunk ${frame}`,
          },
        ],
      })),
    });
  }
  await advance(49);
  expect(storage.saveWorkspaceSnapshot).not.toHaveBeenCalled();
  await advance(1);
  expect(storage.saveWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  expect(storage.saveWorkspaceSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ activeTabId: options.tabs[0].id }),
  );
  await advance(300);
  expect(storage.saveWorkspaceSnapshot).toHaveBeenCalledTimes(1);
});

it("replaces a pending save with the latest navigation snapshot", async () => {
  await render();
  await advance(100);
  await render({ activeTabId: options.tabs[1].id });
  await advance(150);
  expect(storage.saveWorkspaceSnapshot).not.toHaveBeenCalled();
  await advance(100);
  expect(storage.saveWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  expect(storage.saveWorkspaceSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ activeTabId: options.tabs[1].id }),
  );
});

it("preserves boot recovery, deduplicates live turns and clears them after completion", async () => {
  await render();
  expect(storage.replaceInFlightSessions).not.toHaveBeenCalled();
  await render({
    sessions: options.sessions.map((session) => ({ ...session, busy: true })),
  });
  expect(storage.replaceInFlightSessions).toHaveBeenCalledTimes(1);
  expect(storage.replaceInFlightSessions).toHaveBeenLastCalledWith([
    { sessionId: "first", cwd: "/repo" },
    { sessionId: "second", cwd: "/repo" },
  ]);
  await render({
    sessions: options.sessions.map((session) => ({ ...session })),
  });
  expect(storage.replaceInFlightSessions).toHaveBeenCalledTimes(1);
  await render({
    sessions: options.sessions.map((session) => ({ ...session, busy: false })),
  });
  expect(storage.replaceInFlightSessions).toHaveBeenCalledTimes(2);
  expect(storage.replaceInFlightSessions).toHaveBeenLastCalledWith([]);
});

it("does not overwrite the workspace snapshot from a transferred window", async () => {
  await render({
    windowTransfer: {
      sessions: options.sessions,
      tabs: options.tabs,
      activeTabId: options.activeTabId,
      projectCwd: options.projectCwd,
      dirtyFileIds: [],
    },
    sessions: options.sessions.map((session) => ({ ...session, busy: true })),
  });
  await advance(500);
  expect(storage.saveWorkspaceSnapshot).not.toHaveBeenCalled();
  expect(storage.replaceInFlightSessions).toHaveBeenCalledTimes(1);
});
