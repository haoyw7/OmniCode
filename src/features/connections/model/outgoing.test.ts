import { describe, expect, it } from "vitest";
import type { HostSession } from "./protocol";
import { outgoingPlacement, withOutgoing } from "./outgoing";

function snapshot(overrides: Partial<HostSession> = {}, session: Partial<HostSession["session"]> = {}): HostSession {
  return {
    projectId: "project",
    revision: 1,
    updatedAt: 1,
    status: "idle",
    canSteer: true,
    ...overrides,
    session: {
      id: "session",
      title: "",
      harness: "codex",
      model: "m",
      modelSettings: {},
      runtimeMode: "supervised",
      cwd: "/p",
      blocks: [],
      ...session,
    },
  };
}

describe("outgoing messages", () => {
  it("places sends where the Host records them", () => {
    expect(outgoingPlacement(snapshot(), "queue")).toBe("transcript");
    expect(outgoingPlacement(snapshot({ status: "running" }), "queue")).toBe("queue");
    expect(outgoingPlacement(snapshot({ status: "running" }), "steer")).toBe("transcript");
    expect(outgoingPlacement(snapshot({ status: "running", queueSteeringId: "x" }), "steer")).toBe("queue");
    expect(outgoingPlacement(snapshot({ status: "running", canSteer: false }), "steer")).toBe("queue");
    expect(outgoingPlacement(snapshot({}, { queuedMessages: [{ id: "q", text: "", attachments: [] }] }), "steer"))
      .toBe("queue");
  });

  it("shows a steering row in the transcript and an outgoing one where it will land", () => {
    const base = snapshot({ status: "running", queueSteeringId: "steer" }, {
      queuedMessages: [
        { id: "steer", text: "Now", attachments: [] },
        { id: "later", text: "Later", attachments: [] },
      ],
    });
    const view = withOutgoing(base, { id: "next", text: "Next", placement: "queue" });
    expect(view.session.blocks).toEqual([{ id: "steer", role: "user", text: "Now", sending: true }]);
    expect(view.session.queuedMessages?.map((row) => row.id)).toEqual(["later", "next"]);
    // Once the Host has its copy, nothing is added twice.
    const recorded = { ...base, session: { ...base.session, queuedMessages: [...base.session.queuedMessages!, { id: "next", text: "Next", attachments: [] }] } };
    expect(withOutgoing(recorded, { id: "next", text: "Next", placement: "queue" }).session.queuedMessages?.map((row) => row.id))
      .toEqual(["later", "next"]);
    expect(withOutgoing(snapshot(), undefined)).toEqual(snapshot());
  });
});

it.each([-65_000, 65_000])("keeps optimistic sends in the Host clock domain with %i ms skew", (clockOffsetMs) => {
  const base = snapshot({ clockOffsetMs });
  const outgoing = { id: "new", text: "Hello", startedAt: 100_000, placement: "transcript" as const };
  const view = withOutgoing(base, outgoing);
  expect(view.session.blocks[0].startedAt).toBe(100_000 + clockOffsetMs);
  expect(outgoing.startedAt).toBe(100_000);
  expect(base.session.blocks).toEqual([]);
});
