import { describe, expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { applyHarnessEvent, stopStreaming } from "./apply";
import { AcpSubagents } from "./acpSubagents";
import { sanitizeSessionForPersist } from "../../../features/sessions/data/sessionStore";
import type { HarnessEvent } from "./types";

const spawn = () =>
  applyHarnessEvent(newSession("claude", "/repo"), {
    type: "tool.started",
    callId: "root",
    title: "Review",
    kind: "agent",
  });

describe("complete agent transcripts", () => {
  it("keeps long messages, tool input/output and all steps through persistence", () => {
    let session = spawn();
    const text = "正文".repeat(2500);
    for (let index = 0; index < 305; index++)
      session = applyHarnessEvent(session, {
        type: "agent.step",
        callId: "root",
        stepId: `message:${index}`,
        kind: "message",
        text,
      });
    session = applyHarnessEvent(session, {
      type: "agent.step",
      callId: "root",
      stepId: "tool",
      kind: "tool",
      text: "Read",
      input: "request".repeat(2000),
      output: "result".repeat(2000),
      status: "completed",
    });
    const saved = sanitizeSessionForPersist(session).blocks[0].agentRun!;
    expect(saved.steps).toHaveLength(100);
    expect(saved.transcript).toHaveLength(306);
    expect(saved.transcript![0].text).toBe(text);
    expect(saved.transcript!.at(-1)?.tool).toMatchObject({
      input: "request".repeat(2000),
      output: "result".repeat(2000),
    });
  });

  it("merges streamed and completed messages and retains nested ownership", () => {
    let session = spawn();
    const events: HarnessEvent[] = [
      {
        type: "agent.step",
        callId: "root",
        stepId: "nested",
        kind: "tool",
        toolKind: "agent",
        text: "Inspect",
      },
      {
        type: "agent.updated",
        callId: "nested",
        prompt: "Inspect the change",
        model: "child-model",
      },
      {
        type: "agent.step",
        callId: "nested",
        stepId: "answer",
        kind: "message",
        text: "Full ",
        append: true,
        streaming: true,
      },
      {
        type: "agent.step",
        callId: "nested",
        stepId: "answer",
        kind: "message",
        text: "answer",
        append: true,
        streaming: true,
      },
      {
        type: "agent.step",
        callId: "nested",
        stepId: "answer",
        kind: "message",
        text: "Full answer",
        streaming: false,
      },
      {
        type: "tool.updated",
        callId: "nested",
        kind: "agent",
        status: "completed",
      },
    ];
    session = events.reduce(applyHarnessEvent, session);
    const again = applyHarnessEvent(session, events[4]);
    expect(again).toBe(session);
    expect(session.blocks).toHaveLength(1);
    const child = session.blocks[0].agentRun!.transcript![0];
    expect(child.agentRun!.transcript?.map((row) => row.text)).toEqual([
      "Inspect the change",
      "Full answer",
    ]);
    expect(child.tool?.status).toBe("completed");
    expect(
      sanitizeSessionForPersist(session).blocks[0].agentRun!.transcript![0]
        .agentRun!.model,
    ).toBe("child-model");
  });

  it("replays out-of-order nested ACP messages without flattening or losing successful output", () => {
    const router = new AcpSubagents();
    let session = newSession("grok", "/repo");
    const push = (params: unknown, events: HarnessEvent[]) => {
      session = router.route(params, events).reduce(applyHarnessEvent, session);
    };
    push({ parentToolCallId: "nested" }, [
      { type: "message.delta", text: "Early child" },
    ]);
    push({ parentToolCallId: "root" }, [
      {
        type: "tool.started",
        callId: "nested",
        kind: "agent",
        title: "Nested",
      },
    ]);
    push({ parentToolCallId: "nested" }, [
      {
        type: "tool.updated",
        callId: "read",
        title: "Read",
        kind: "read",
        status: "completed",
        detail: "x".repeat(10000),
      },
    ]);
    push({}, [
      { type: "tool.started", callId: "root", title: "Root", kind: "agent" },
    ]);
    const nested =
      session.blocks[0].agentRun!.transcript![0].agentRun!.transcript!;
    expect(nested[0].text).toBe("Early child");
    expect(nested[1].tool?.output).toHaveLength(10000);
    expect(session.blocks).toHaveLength(1);
  });

  it("keeps a partial-history notice and stores images under their agent", () => {
    let session = spawn();
    session = applyHarnessEvent(session, {
      type: "agent.updated",
      callId: "root",
      coverage: "partial",
    });
    session = applyHarnessEvent(session, {
      type: "agent.updated",
      callId: "root",
      coverage: "recorded",
    });
    session = applyHarnessEvent(session, {
      type: "image.generated",
      agentCallId: "root",
      itemId: "image",
      path: "/image.png",
      name: "image",
      mimeType: "image/png",
      size: 1,
    });
    expect(session.blocks).toHaveLength(1);
    expect(session.blocks[0].agentRun!.coverage).toBe("partial");
    expect(
      sanitizeSessionForPersist(session).blocks[0].agentRun!.transcript![0]
        .image?.path,
    ).toBe("/image.png");
  });

  it("seals nested streaming prose when the owning session stops", () => {
    let session = spawn();
    session = applyHarnessEvent(session, {
      type: "agent.step",
      callId: "root",
      stepId: "a",
      kind: "message",
      text: "Partial",
      streaming: true,
    });
    expect(
      stopStreaming(session).blocks[0].agentRun!.transcript![0].streaming,
    ).toBe(false);
    session = applyHarnessEvent(session, {
      type: "agent.step",
      callId: "root",
      stepId: "tool",
      kind: "tool",
      text: "Still running",
      status: "in_progress",
    });
    expect(
      stopStreaming(session).blocks[0].agentRun!.transcript![1].tool?.status,
    ).toBe("cancelled");
  });
  it("uses explicit ancestry to disambiguate repeated tool ids", () => {
    let session = spawn();
    for (const id of ["left", "right"]) {
      session = applyHarnessEvent(session, {
        type: "agent.step",
        callId: "root",
        stepId: id,
        kind: "tool",
        toolKind: "agent",
        text: id,
      });
      session = applyHarnessEvent(session, {
        type: "agent.step",
        callId: "root",
        agentPath: [id],
        stepId: "shared",
        kind: "tool",
        toolKind: "agent",
        text: "Nested",
      });
    }
    const ambiguous = applyHarnessEvent(session, {
      type: "agent.step",
      callId: "shared",
      stepId: "answer",
      kind: "message",
      text: "Do not guess",
    });
    expect(ambiguous).toBe(session);
    session = applyHarnessEvent(session, {
      type: "agent.step",
      callId: "root",
      agentPath: ["right", "shared"],
      stepId: "answer",
      kind: "message",
      text: "Right answer",
    });
    const branches = session.blocks[0].agentRun!.transcript!;
    expect(branches[0].agentRun!.transcript![0].agentRun).toBeUndefined();
    expect(
      branches[1].agentRun!.transcript![0].agentRun!.transcript![0].text,
    ).toBe("Right answer");
  });
  it("does not reopen completed tools or duplicate replayed child images", () => {
    let session = spawn();
    session = applyHarnessEvent(session, {
      type: "agent.step",
      callId: "root",
      stepId: "read",
      kind: "tool",
      text: "Read",
      status: "completed",
      output: "Result",
    });
    session = applyHarnessEvent(session, {
      type: "agent.step",
      callId: "root",
      stepId: "read",
      kind: "tool",
      text: "Read",
      status: "in_progress",
    });
    const tool = session.blocks[0].agentRun!.transcript![0];
    expect(tool.tool?.status).toBe("completed");
    expect(tool.streaming).toBe(false);
    const image: HarnessEvent = {
      type: "image.generated",
      agentCallId: "root",
      itemId: "image",
      path: "/image.png",
      name: "image",
      mimeType: "image/png",
      size: 1,
    };
    session = applyHarnessEvent(session, image);
    expect(applyHarnessEvent(session, image)).toBe(session);
  });
});
