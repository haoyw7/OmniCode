import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

async function loadStore() {
  vi.resetModules();
  return import("./sessionStore");
}

type Block = { id: string; role: "user" | "assistant"; text: string };

function blocks(count: number): Block[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `b${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text: `text ${index}`,
  }));
}

function session(blocks: Block[]) {
  return {
    id: "s",
    cwd: "/tmp/project",
    harness: "cursor" as const,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised" as const,
    title: "",
    blocks,
    busy: false,
  };
}

function upserts() {
  return mocks.invoke.mock.calls
    .filter(([command]) => command === "session_upsert")
    .map(([, args]) => args);
}

afterEach(() => {
  mocks.invoke.mockReset();
});

describe("session tail writes", () => {
  it("persists the running send time and completed reply time even when sending only a tail", async () => {
    mocks.invoke.mockResolvedValue({ id: "s", cwd: "/tmp/project" });
    const { upsertSession } = await loadStore();
    const transcript = [...blocks(10),
      { id: "u", role: "user" as const, text: "Question", startedAt: 100 },
      { id: "a", role: "assistant" as const, text: "Answer", sentAt: 200 },
    ];
    await upsertSession({ ...session(transcript), busy: true });
    await upsertSession(session(transcript));
    expect(upserts().map((payload) => payload.session.activityAt)).toEqual([100, 200]);
    expect(upserts()[1].blocksFrom).toBe(transcript.length);
  });

  it("sends only the blocks after the first changed one", async () => {
    mocks.invoke.mockResolvedValue({ id: "s", cwd: "/tmp/project" });
    const { upsertSession } = await loadStore();
    const first = blocks(10);
    await upsertSession(session(first));
    const changed = { ...first[9], text: "final" };
    const next = [...first.slice(0, 9), changed, ...blocks(12).slice(10)];
    await upsertSession(session(next));

    const [full, tail] = upserts();
    expect(full.blocksFrom).toBeUndefined();
    expect(full.session.blocks).toHaveLength(10);
    expect(tail.blocksFrom).toBe(9);
    expect(tail.baseBlocksLen).toBe(10);
    expect(tail.session.blocks.map((block: Block) => block.id)).toEqual([
      "b9",
      "b10",
      "b11",
    ]);
    expect(tail.session.blocks[0].text).toBe("final");
  });

  it("retries with every block when the stored transcript moved", async () => {
    let calls = 0;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== "session_upsert") return undefined;
      calls++;
      if (calls === 2) throw "stale-blocks";
      return { id: "s", cwd: "/tmp/project" };
    });
    const { upsertSession } = await loadStore();
    const first = blocks(10);
    await upsertSession(session(first));
    await upsertSession(session([...first, ...blocks(11).slice(10)]));

    const [, tail, retry] = upserts();
    expect(tail.blocksFrom).toBe(10);
    expect(retry.blocksFrom).toBeUndefined();
    expect(retry.session.blocks).toHaveLength(11);
  });

  it("writes everything again after a failed write", async () => {
    let calls = 0;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== "session_upsert") return undefined;
      calls++;
      if (calls === 2) throw new Error("disk full");
      return { id: "s", cwd: "/tmp/project" };
    });
    const { upsertSession } = await loadStore();
    const first = blocks(10);
    await upsertSession(session(first));
    const grown = [...first, ...blocks(11).slice(10)];
    await expect(upsertSession(session(grown))).rejects.toThrow("disk full");
    await upsertSession(session(grown));

    const [, failed, recovered] = upserts();
    expect(failed.blocksFrom).toBe(10);
    expect(recovered.blocksFrom).toBeUndefined();
  });
});
