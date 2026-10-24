// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { Block, Session } from "../../contracts/session";
import type { HostCommand, HostSession } from "../../contracts/protocol";
import { newSession } from "../../features/sessions/model/session";
import { useBtwConversations } from "./useBtwConversations";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), toast: vi.fn() }));
vi.mock("../../features/connections/model/hostSessionSubmission", () => ({ mutateHostSession: mocks.mutate }));
vi.mock("../../shared/ui/StatusToast", () => ({ showStatusToast: mocks.toast }));

const turn: Block[] = [
  { id: "u1", role: "user", text: "Fix it", durationMs: 10 },
  { id: "a1", role: "assistant", text: "Done" },
];
const source: Session = { ...newSession("codex", "/repo"), id: "s1", blocks: turn };

function mount(session: Session) {
  const sessionsRef = { current: [session] };
  const setSessions = vi.fn();
  let api!: ReturnType<typeof useBtwConversations>;
  function Probe() {
    api = useBtwConversations({ sessionsRef, setSessions });
    return null;
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() => createRoot(document.createElement("div")).render(createElement(Probe)));
  return { api: () => api, setSessions };
}

async function dispatched(): Promise<HostCommand> {
  await act(async () => {});
  const build = mocks.mutate.mock.calls.at(-1)![1] as (snapshot: HostSession, id: string) => HostCommand;
  expect(mocks.mutate.mock.calls.at(-1)![2]).toBe("sessions.btw.v1");
  return build({ session: { ...source, id: "host-1" } } as HostSession, "c1");
}

beforeEach(() => {
  mocks.mutate.mockReset().mockResolvedValue({ session: { ...source, id: "host-1" } });
  mocks.toast.mockReset();
});

it("sends side questions to the Host against its own session ID", async () => {
  const { api, setSessions } = mount(source);
  expect(api().onBtwSubmit("s1", turn, "t1", "m1", "Why?", "gpt-5", { effort: "low" })).toBe(true);
  expect(await dispatched()).toEqual({ type: "btw", action: "send", commandId: "c1", sessionId: "host-1",
    userBlockId: "u1", threadId: "t1", sourceEndBlockId: "a1", messageId: "m1", text: "Why?",
    model: "gpt-5", modelSettings: { effort: "low" } });
  // The pane keeps its own ID while showing the Host projection.
  expect(setSessions).toHaveBeenCalled();
});

it("only stops running threads and retries failed ones", async () => {
  const thread = { id: "t1", sourceEndBlockId: "a1", createdAt: 1, updatedAt: 1, harness: "codex" as const,
    status: "running" as const, messages: [{ id: "m1", role: "user" as const, text: "Why?", createdAt: 1 }] };
  const withThread = { ...source, blocks: [{ ...turn[0], btwThreads: [thread] }, turn[1]] };
  const { api } = mount(withThread);
  api().onBtwRetry("s1", turn, "t1");
  expect(mocks.mutate).not.toHaveBeenCalled();
  api().onBtwStop("s1", turn, "t1");
  expect(await dispatched()).toMatchObject({ type: "btw", action: "stop", threadId: "t1", sessionId: "host-1" });
  expect(api().onBtwSubmit("s1", turn, "t1", "m2", "Again")).toBe(false);
});

it("rejects removed worktrees before dispatching", () => {
  const { api } = mount({ ...source, worktreeRemoved: true });
  expect(api().onBtwSubmit("s1", turn, "t1", "m1", "Why?")).toBe(false);
  expect(mocks.mutate).not.toHaveBeenCalled();
});
