import { PROVIDER_INTERACTION_CAPABILITIES } from "../../../integrations/harness/providers/interactionCapabilities";
import { describe, expect, it } from "vitest";
import {
  applyHarnessEvent,
  stopStreaming,
} from "../../../integrations/harness/core/apply";
import { sanitizeSessionForPersist } from "../data/sessionStore";
import { newSession } from "./session";
import {
  latestAnswerableQuestionId,
  questionFollowUp,
  recordQuestionAnswer,
  providerQuestionReply,
} from "./questionHistory";
import type { QuestionAnswer, UserQuestion } from "./userQuestion";

const questions: UserQuestion[] = [
  {
    id: "q",
    prompt: "Which source?",
    allowCustom: true,
    multiSelect: false,
    options: [{ id: "local", label: "Local" }],
  },
];
const ask = () =>
  applyHarnessEvent(newSession("codex", "/repo"), {
    type: "question.asked",
    requestId: 7,
    allowLateReply: true,
    autoResolveAt: Date.now() + 120_000,
    questions,
  });
const answer = (blockId: string): QuestionAnswer => ({
  blockId,
  reply: {
    kind: "answered",
    answers: { q: ["__custom__"] },
    custom: { q: "Use the archive" },
  },
});

describe("question history", () => {
  it("retains the native question and complete plan through persistence for late DeepSeek replies", () => {
    const live = applyHarnessEvent(newSession("deepseek", "/repo"), {
      type: "question.asked", requestId: 1, providerQuestionId: "native-call", allowLateReply: true,
      questions: [{ ...questions[0], detail: "# Complete plan\n\n1. Verify", intent: { kind: "plan-review", approve: "Local", callId: "native-call" } }],
    });
    const saved = sanitizeSessionForPersist(live);
    const record = saved.blocks[0].question!;
    expect(record).toMatchObject({ providerQuestionId: "native-call", questions: [{ detail: "# Complete plan\n\n1. Verify", intent: { callId: "native-call" } }] });
    const restored = { ...newSession("deepseek", "/repo"), blocks: saved.blocks };
    const reply = answer(saved.blocks[0].id);
    expect(latestAnswerableQuestionId(restored, interactionCapabilitiesForTest(restored))).toBe(reply.blockId);
    expect(questionFollowUp(restored, reply, interactionCapabilitiesForTest(restored))).toContain("Use the archive");
    expect(providerQuestionReply(restored, reply)).toEqual({ requestId: "native-call", reply: reply.reply });
  });
  it("docks only the newest unanswered saved question until the user writes past it", () => {
    const live = ask();
    expect(latestAnswerableQuestionId(live, interactionCapabilitiesForTest(live))).toBeUndefined();
    const saved = stopStreaming(live);
    const id = saved.blocks[0].id;
    expect(latestAnswerableQuestionId(saved, interactionCapabilitiesForTest(saved))).toBe(id);
    expect(
      latestAnswerableQuestionId(recordQuestionAnswer(saved, answer(id)), interactionCapabilitiesForTest(recordQuestionAnswer(saved, answer(id)))),
    ).toBeUndefined();
    expect(
      latestAnswerableQuestionId({
        ...saved,
        blocks: [...saved.blocks, { id: "u", role: "user", text: "Other" }],
      }, interactionCapabilitiesForTest({
        ...saved,
        blocks: [...saved.blocks, { id: "u", role: "user", text: "Other" }],
      })),
    ).toBeUndefined();
  });

  it("preserves missed async questions through persistence without restoring a timer", () => {
    const live = ask();
    const saved = sanitizeSessionForPersist(live);
    expect(saved.blocks[0].question).toMatchObject({
      questions,
      allowLateReply: true,
      decision: "cancelled",
    });
    expect(saved.blocks[0].question?.autoResolveAt).toBeUndefined();
    const restored = {
      ...newSession("codex", "/repo"),
      blocks: JSON.parse(JSON.stringify(saved.blocks)),
    };
    const reply = answer(restored.blocks[0].id);
    expect(questionFollowUp(restored, reply, interactionCapabilitiesForTest(restored))).toBe(
      "Which source?\nUse the archive",
    );
    const answered = sanitizeSessionForPersist(
      recordQuestionAnswer(restored, reply),
    );
    expect(answered.blocks[0].question?.reply).toEqual(reply.reply);
    expect(answered.blocks[0].text).toBe("Which source?\nUse the archive");
  });

  it("keeps old answers separate when a later request reuses its live ID", () => {
    let session = stopStreaming(ask());
    const oldId = session.blocks[0].id;
    session = applyHarnessEvent(session, {
      type: "question.asked",
      requestId: 7,
      questions,
    });
    const currentId = session.pendingQuestion!.historyId;
    expect(currentId).not.toBe(oldId);
    session = recordQuestionAnswer(session, answer(oldId));
    expect(session.blocks[0].question?.reply?.custom?.q).toBe(
      "Use the archive",
    );
    expect(session.pendingQuestion?.historyId).toBe(currentId);
    expect(session.blocks[1].question?.reply).toBeUndefined();
    session = applyHarnessEvent(session, {
      type: "question.resolved",
      requestId: 7,
      decision: "answered",
      reply: { kind: "answered", answers: { q: ["local"] } },
    });
    expect(session.blocks[0].question?.reply?.custom?.q).toBe(
      "Use the archive",
    );
    expect(session.blocks[1].question?.reply?.answers.q).toEqual(["local"]);
  });

  it("rejects live, blocking, duplicate and invalid late answers", () => {
    const live = ask();
    const reply = answer(live.blocks[0].id);
    expect(() => questionFollowUp(live, reply, interactionCapabilitiesForTest(live))).toThrow("currently open");
    const closed = stopStreaming(live);
    expect(() =>
      questionFollowUp({ ...closed, harness: "claude" }, reply, interactionCapabilitiesForTest({ ...closed, harness: "claude" })),
    ).toThrow("cannot be answered later");
    expect(() =>
      questionFollowUp(recordQuestionAnswer(closed, reply), reply, interactionCapabilitiesForTest(recordQuestionAnswer(closed, reply))),
    ).toThrow("already answered");
    expect(() =>
      questionFollowUp(closed, {
        ...reply,
        reply: { kind: "answered", answers: { q: ["unknown"] } },
      }, interactionCapabilitiesForTest(closed)),
    ).toThrow("Invalid question answers");
    expect(() =>
      questionFollowUp(
        {
          ...closed,
          blocks: closed.blocks.map((block) => ({
            ...block,
            question: { ...block.question!, allowLateReply: undefined },
          })),
        },
        reply, interactionCapabilitiesForTest({
          ...closed,
          blocks: closed.blocks.map((block) => ({
            ...block,
            question: { ...block.question!, allowLateReply: undefined },
          })),
        }),
      ),
    ).toThrow("cannot be answered later");
  });

  it("preserves native editor semantics and verbatim replies in saved records", () => {
    let session = applyHarnessEvent(newSession("pi", "/repo"), {
      type: "question.asked",
      requestId: 1,
      questions: [
        {
          id: "editor",
          prompt: "Edit text",
          allowCustom: true,
          multiSelect: false,
          options: [],
          input: {
            kind: "multiline",
            initialValue: "  old\ntext  ",
            allowEmpty: true,
            preserveWhitespace: true,
          },
        },
      ],
    });
    session = applyHarnessEvent(session, {
      type: "question.resolved",
      requestId: 1,
      decision: "answered",
      reply: {
        kind: "answered",
        answers: {},
        custom: { editor: "  new\ntext  " },
      },
    });
    const saved = sanitizeSessionForPersist(session).blocks[0].question!;
    expect(saved.questions[0].input).toEqual(
      session.blocks[0].question!.questions[0].input,
    );
    expect(saved.reply?.custom?.editor).toBe("  new\ntext  ");
    expect(sanitizeSessionForPersist(session).blocks[0].text).toBe("Edit text\n  new\ntext  ");
  });
});

function interactionCapabilitiesForTest(session: { harness: keyof typeof PROVIDER_INTERACTION_CAPABILITIES }) {
  return PROVIDER_INTERACTION_CAPABILITIES[session.harness];
}
