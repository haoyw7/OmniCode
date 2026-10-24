// @vitest-environment happy-dom
import { rememberLoadedSession } from "../../features/sessions/data/sessionCache";
import { act, createElement, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationRun } from "../../contracts/session";
import { flushSessionWrites, upsertSession, type SessionRecord } from "../../features/sessions/data/sessionStore";
import { useUnseenFinishedSessions } from "../../features/sessions/hooks/useUnseenFinishedSessions";
import { liveAgentsFromSessions } from "../../features/sessions/model/liveAgents";
import { newSession } from "../../features/sessions/model/session";
import { type Session } from "../../contracts/session";
import { closeLeaf, newSubagentTab, newTab, openEditorTab, type WorkspaceTab } from "../../features/workspace/model/layout";
import { useIdleSessionDetach } from "./useIdleSessionDetach";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let root: Root | undefined;
let container: HTMLDivElement;
let stored: Map<string, SessionRecord>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  stored = new Map();
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "session_upsert") {
      const record = structuredClone({
        ...args.session,
        createdAt: 1,
        updatedAt: 2,
      });
      stored.set(record.id, record);
      return record;
    }
    if (command === "session_get") {
      return structuredClone(stored.get(args.sessionId) ?? null);
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root?.unmount());
  container.remove();
  await flushSessionWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chat(id: string, patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/repo"),
    id,
    blocks: [
      { id: `${id}-user`, role: "user", text: "Review the assigned files" },
      {
        id: `${id}-answer`,
        role: "assistant",
        text: "The assignment is complete.",
      },
    ],
    ...patch,
  };
}

function run(status: OrchestrationRun["status"]): OrchestrationRun {
  return {
    version: 1,
    leadId: "lead",
    cwd: "/repo",
    status,
    allowedHarnesses: ["claude"],
    maxWorkers: 1,
    cli: "omnicode",
    tasks: [],
    continuations: 0,
    requests: {},
  };
}

type WorkspaceState = {
  sessions: Session[];
  tabs: WorkspaceTab[];
  orchestrationRuns: OrchestrationRun[];
  busySessionIds: ReadonlySet<string>;
  activeSessionId: string;
  liveAgentsEnabled: boolean;
};

function mountWorkspace(initial: Partial<WorkspaceState> = {}) {
  let props: WorkspaceState = {
    sessions: [
      chat("lead", { busy: true }),
      chat("worker", {
        busy: true,
        orchestrationLeadId: "lead",
        providerSessionId: "worker-thread",
        executionCwd: "/repo-workers/worker",
      }),
      chat("other"),
    ],
    tabs: [newTab("lead"), newTab("other")],
    orchestrationRuns: [run("active")],
    busySessionIds: new Set(["lead", "worker"]),
    activeSessionId: "other",
    liveAgentsEnabled: true,
    ...initial,
  };
  const sessionsRef = { current: props.sessions };
  const tabsRef = { current: props.tabs };
  const openingSessionIds = { current: new Set<string>() };
  const loadedSessionCache = { current: new Map<string, Session>() };
  const skipForgetSessionIds = { current: new Set<string>() };
  const persistSession = vi.fn((session: Session | undefined) => {
    return session ? upsertSession(session) : Promise.resolve(null);
  });
  const sessionData = {
    activate: (id: string) => {
      openingSessionIds.current.delete(id);
      loadedSessionCache.current.delete(id);
    },
    isOpening: (id: string) => openingSessionIds.current.has(id),
    retain: (session: Session) =>
      rememberLoadedSession(loadedSessionCache.current, session),
    persist: persistSession,
  };
  let snapshot!: {
    sessions: Session[];
    unseenFinishedIds: Set<string>;
    setSessions: Dispatch<SetStateAction<Session[]>>;
  };

  function Workspace(state: WorkspaceState) {
    const [sessions, setSessions] = useState(state.sessions);
    sessionsRef.current = sessions;
    tabsRef.current = state.tabs;
    const unseenFinishedIds = useUnseenFinishedSessions(
      sessions,
      state.busySessionIds,
      state.activeSessionId,
    );
    useIdleSessionDetach({
      ...state,
      sessions,
      sessionsRef,
      tabsRef,
      unseenFinishedIds,
      sessionData,
      skipForgetSessionIds,
      setSessions,
    });
    snapshot = { sessions, unseenFinishedIds, setSessions };
    return null;
  }

  act(() => root!.render(createElement(Workspace, props)));
  const update = (patch: Partial<WorkspaceState>) => {
    props = { ...props, ...patch };
    act(() => {
      if (patch.sessions) snapshot.setSessions(patch.sessions);
      root!.render(createElement(Workspace, props));
    });
  };
  return {
    snapshot: () => snapshot,
    update,
    finish: (status: OrchestrationRun["status"] = "finished") =>
      update({
        sessions: snapshot.sessions.map((session) => ({
          ...session,
          busy: false,
        })),
        busySessionIds: new Set(),
        orchestrationRuns: [run(status)],
      }),
    persistSession,
    openingSessionIds: openingSessionIds.current,
    cache: loadedSessionCache.current,
    skipForgetSessionIds: skipForgetSessionIds.current,
  };
}

async function advance(milliseconds = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await flushSessionWrites();
}

describe("orchestration worker detachment", () => {
  it("retains a closed parent's records until its last subagent tab closes", async () => {
    const tab = openEditorTab(
      newTab("parent"),
      newSubagentTab("Reviewer", "/repo", {
        parentSessionId: "parent",
        path: ["child"],
        harness: "claude",
      }),
    );
    const workspace = mountWorkspace({
      sessions: [chat("parent")],
      tabs: [closeLeaf(tab, "parent")!],
      orchestrationRuns: [],
      busySessionIds: new Set(),
      liveAgentsEnabled: false,
    });
    await advance();
    expect(workspace.snapshot().sessions.map((session) => session.id)).toEqual([
      "parent",
    ]);
    workspace.update({ tabs: [] });
    await advance();
    expect(workspace.snapshot().sessions).toEqual([]);
  });

  it("retains finished workers until their lead closes, then persists and detaches them", async () => {
    const workspace = mountWorkspace();
    await advance();
    workspace.finish();
    await advance();
    expect(
      workspace.snapshot().sessions.map((session) => session.id),
    ).toContain("worker");
    expect(workspace.persistSession).not.toHaveBeenCalled();

    workspace.update({ tabs: [newTab("other")] });
    await advance(249);
    expect(
      workspace.snapshot().sessions.map((session) => session.id),
    ).toContain("worker");
    await advance(1);

    expect(workspace.snapshot().sessions.map((session) => session.id)).toEqual([
      "lead",
      "other",
    ]);
    expect(workspace.snapshot().unseenFinishedIds).toEqual(new Set(["lead"]));
    expect(
      liveAgentsFromSessions(
        workspace.snapshot().sessions,
        workspace.snapshot().unseenFinishedIds,
      ),
    ).toMatchObject([{ id: "lead", done: true }]);
    expect(workspace.persistSession).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "worker", busy: false }),
    );
  });

  it.each(["active", "paused"] as const)(
    "keeps idle workers of a closed lead attached while the run is %s",
    async (status) => {
      const workspace = mountWorkspace();
      workspace.finish(status);
      workspace.update({ tabs: [newTab("other")] });
      await advance();
      expect(
        workspace.snapshot().sessions.map((session) => session.id),
      ).toContain("worker");
      expect(workspace.persistSession).not.toHaveBeenCalled();

      workspace.update({ orchestrationRuns: [run("finished")] });
      await advance();
      expect(
        workspace.snapshot().sessions.map((session) => session.id),
      ).not.toContain("worker");
    },
  );

  it.each(["finished", "stopped"] as const)(
    "uses the latest %s run and closed tabs when a detach timer is already pending",
    async (status) => {
      const workspace = mountWorkspace();
      await advance(100);
      workspace.finish(status);
      workspace.update({ tabs: [newTab("other")] });
      await advance(150);
      expect(
        workspace.snapshot().sessions.map((session) => session.id),
      ).not.toContain("worker");
    },
  );

  it.each(["busy", "opening", "transferring"] as const)(
    "does not detach a %s worker even after the run finishes",
    async (reason) => {
      const workspace = mountWorkspace({
        sessions: [
          chat("worker", {
            orchestrationLeadId: "lead",
            busy: reason === "busy",
          }),
          chat("other"),
        ],
        tabs: [newTab("other")],
        orchestrationRuns: [run("finished")],
        busySessionIds: new Set(reason === "busy" ? ["lead", "worker"] : []),
      });
      if (reason === "opening") workspace.openingSessionIds.add("worker");
      if (reason === "transferring")
        workspace.skipForgetSessionIds.add("worker");
      await advance();
      expect(
        workspace.snapshot().sessions.map((session) => session.id),
      ).toContain("worker");
      expect(workspace.persistSession).not.toHaveBeenCalled();
    },
  );

  it("keeps ordinary unseen finished chats until they are focused", async () => {
    const workspace = mountWorkspace({
      sessions: [chat("ordinary", { busy: true }), chat("other")],
      tabs: [newTab("other")],
      orchestrationRuns: [],
      busySessionIds: new Set(["ordinary"]),
    });
    workspace.finish();
    await advance();
    expect(workspace.snapshot().unseenFinishedIds).toEqual(
      new Set(["ordinary"]),
    );

    workspace.update({
      tabs: [newTab("ordinary")],
      activeSessionId: "ordinary",
    });
    await advance();
    expect(workspace.snapshot().unseenFinishedIds.size).toBe(0);
    workspace.update({ tabs: [], activeSessionId: "other" });
    await advance();
    expect(
      workspace.snapshot().sessions.map((session) => session.id),
    ).not.toContain("ordinary");
  });

  it("does not retain unseen finished chats when Live Agents is disabled", async () => {
    const workspace = mountWorkspace({
      sessions: [chat("ordinary", { busy: true }), chat("other")],
      tabs: [newTab("other")],
      orchestrationRuns: [],
      busySessionIds: new Set(["ordinary"]),
    });
    workspace.finish();
    await advance();
    workspace.update({ liveAgentsEnabled: false });
    await advance();
    expect(workspace.snapshot().sessions.map((session) => session.id)).toEqual([
      "other",
    ]);
  });

  it("keeps inbox discussions mounted without marking them unseen", async () => {
    const workspace = mountWorkspace({
      sessions: [chat("inbox", { inboxAsk: true, busy: true }), chat("other")],
      tabs: [newTab("other")],
      orchestrationRuns: [],
      busySessionIds: new Set(["inbox"]),
    });
    workspace.finish();
    await advance();
    expect(workspace.snapshot().unseenFinishedIds.size).toBe(0);
    expect(
      workspace.snapshot().sessions.map((session) => session.id),
    ).toContain("inbox");
    expect(workspace.persistSession).not.toHaveBeenCalled();
  });

  it("cancels pending detachment when the workspace unmounts", async () => {
    const workspace = mountWorkspace();
    workspace.finish();
    workspace.update({ tabs: [newTab("other")] });
    act(() => root!.unmount());
    root = undefined;
    await advance();
    expect(workspace.persistSession).not.toHaveBeenCalled();
  });
});
