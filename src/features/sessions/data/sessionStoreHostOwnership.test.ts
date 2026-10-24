import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession } from "../model/session";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { deleteSession, discardDraftSessionRecord, getSession, listSessionsByProject, persistManualSessionTitle, setSessionArchived, setSessionLinkedWorkItem, setSessionPinned, shouldPersistSession, upsertSession } from "./sessionStore";
import { setSharedSessionBackend, type SharedSessionBackend } from "./sharedSessionBackend";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  configureSharedHost(undefined, []);
  setSharedSessionBackend(undefined);
  vi.resetAllMocks();
});

it.each(["/repo", "C:\\repo", "remote://paired/repo"])(
  "never writes a project transcript to Rust while Host is unavailable: %s",
  async (cwd) => {
    configureSharedHost(undefined, []);
    const session = newSession("codex", cwd);
    session.blocks = [{ id: "u", role: "user", text: "hello" }];
    expect(shouldPersistSession(session)).toBe(false);
    expect(await upsertSession(session)).toBeNull();
    configureSharedHost("local", []);
    expect(await upsertSession(session)).toBeNull();
    configureSharedHost(undefined, []);
    expect(await upsertSession(session)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("keeps a blank chat ephemeral before its directory is created", async () => {
  const session = newSession("codex", "~");
  session.blocks = [{ id: "u", role: "user", text: "hello" }];
  expect(await upsertSession(session)).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

const mutations = [
  ["archive", (id: string) => setSessionArchived(id, true)],
  ["pin", (id: string) => setSessionPinned(id, true)],
  ["link", (id: string) => setSessionLinkedWorkItem(id, undefined)],
  ["delete", (id: string) => deleteSession(id)],
  ["discard draft", (id: string) => discardDraftSessionRecord(id)],
] as const;

it.each(mutations)("rejects %s on a legacy cache while Host is unavailable", async (_name, mutate) => {
  const session = newSession("codex", "/repo");
  vi.mocked(invoke).mockResolvedValue(session);
  await expect(mutate(session.id)).rejects.toThrow("Conversation changes must be saved by the Host");
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["session_get"]);
});

it.each(mutations)("routes %s to Host if it becomes ready during the cache read", async (_name, mutate) => {
  const session = newSession("codex", "/repo");
  const update = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  vi.mocked(invoke).mockImplementation(async () => {
    setSharedSessionBackend({ ownsSession: () => true, update, delete: remove } as unknown as SharedSessionBackend);
    return session as never;
  });
  await mutate(session.id);
  expect(update.mock.calls.length + remove.mock.calls.length).toBe(1);
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["session_get"]);
});

it("keeps cache reads available when Host preparation fails", async () => {
  const session = { ...newSession("codex", "/repo"), blocks: [{ id: "u", role: "user", text: "hello" }] };
  vi.mocked(invoke).mockImplementation(async (command) => (command === "session_list_by_project" ? [session] : session) as never);
  expect(await getSession(session.id)).toMatchObject({ id: session.id, blocks: session.blocks });
  expect(await listSessionsByProject(session.cwd)).toMatchObject([{ id: session.id }]);
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["session_get", "session_list_by_project"]);
});

it("rejects a cached conversation rename without writing Rust", async () => {
  const session = newSession("codex", "/repo");
  session.blocks = [{ id: "u", role: "user", text: "hello" }];
  await expect(persistManualSessionTitle(session, "new title")).rejects.toThrow("Conversation changes must be saved by the Host");
  expect(invoke).not.toHaveBeenCalled();
});
