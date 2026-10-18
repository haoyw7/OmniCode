import type { Session } from "./session";
import {
  buildQuestionReply,
  isCustomSelection,
  questionsFromUnknown,
  selectedAnswerLabels,
  type QuestionAnswer,
  type UserQuestionRecord,
  type UserQuestion,
  type UserQuestionReply,
} from "./userQuestion";

export function questionRecordAnswers(
  question: UserQuestion,
  reply: Extract<UserQuestionReply, { kind: "answered" }>,
): string[] {
  const text = reply.custom?.[question.id];
  return question.input?.preserveWhitespace && typeof text === "string"
    ? [text]
    : selectedAnswerLabels(question, reply);
}

export function questionTranscriptText(record: UserQuestionRecord): string {
  return record.questions
    .map((question) => {
      const labels = record.reply
        ? questionRecordAnswers(question, record.reply)
        : [];
      return [question.prompt, ...labels].join("\n");
    })
    .join("\n\n");
}

/** Revalidate against persisted questions, never a stale live request ID. */
export function questionFollowUp(
  session: Session,
  answer: QuestionAnswer,
): string {
  const record = session.blocks.find(
    (block) => block.id === answer.blockId,
  )?.question;
  if (session.harness !== "codex" || !record?.allowLateReply)
    throw new Error("This question cannot be answered later");
  if (record.reply || record.decision === "answered")
    throw new Error("Question is already answered");
  if (session.pendingQuestion?.historyId === answer.blockId)
    throw new Error("Answer the currently open question first");
  for (const [id, selected] of Object.entries(answer.reply.answers)) {
    const question = record.questions.find((entry) => entry.id === id);
    if (
      !question ||
      selected.some(
        (option) =>
          !question.options.some((entry) => entry.id === option) &&
          !(question.allowCustom && isCustomSelection(question, option)),
      )
    )
      throw new Error("Invalid question answers");
  }
  const reply = buildQuestionReply(
    record.questions,
    answer.reply.answers,
    answer.reply.custom,
  );
  if (reply.kind !== "answered")
    throw new Error("Answer at least one question");
  return questionTranscriptText({
    ...record,
    reply,
    questions: record.questions.filter(
      (question) => selectedAnswerLabels(question, reply).length > 0,
    ),
  });
}

export function questionAnswerableLater(
  session: Session,
  blockId: string | undefined,
): boolean {
  const record = blockId
    ? session.blocks.find((block) => block.id === blockId)?.question
    : undefined;
  return (
    session.harness === "codex" &&
    !!record?.allowLateReply &&
    !record.reply &&
    record.decision !== "answered" &&
    session.pendingQuestion?.historyId !== blockId
  );
}

/** The newest saved question, while the user has not written past it. */
export function latestAnswerableQuestionId(
  session: Session,
): string | undefined {
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index]!;
    if (block.question)
      return questionAnswerableLater(session, block.id) ? block.id : undefined;
    if (block.role === "user") return undefined;
  }
  return undefined;
}

/** Persist the record without restoring a live request or an expired timer. */
export function restoreQuestionRecord(
  value: unknown,
  blockId: string,
): UserQuestionRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<UserQuestionRecord>;
  if (
    !Number.isSafeInteger(record.requestId) ||
    record.requestId! < 0 ||
    !Array.isArray(record.questions)
  )
    return undefined;
  const questions = questionsFromUnknown({ questions: record.questions }).map(
    (question) => {
      const input = record.questions!.find((item) => item?.id === question.id)?.input;
      if (input?.kind !== "text" && input?.kind !== "multiline")
        return question;
      const restored: UserQuestion["input"] = {
        kind: input.kind,
        ...(typeof input.initialValue === "string"
          ? { initialValue: input.initialValue }
          : {}),
        ...(typeof input.placeholder === "string"
          ? { placeholder: input.placeholder }
          : {}),
        ...(input.preserveWhitespace === true
          ? { preserveWhitespace: true }
          : {}),
        ...(input.allowEmpty === true ? { allowEmpty: true } : {}),
        ...(Number.isSafeInteger(input.maxLength) && input.maxLength! >= 0
          ? { maxLength: input.maxLength }
          : {}),
      };
      return { ...question, input: restored };
    },
  );
  if (!questions.length) return undefined;
  const raw = record.reply;
  let reply;
  if (
    raw?.kind === "answered" &&
    raw.answers &&
    typeof raw.answers === "object" &&
    !Array.isArray(raw.answers)
  ) {
    const answers = Object.fromEntries(
      Object.entries(raw.answers).filter(
        ([, ids]) =>
          Array.isArray(ids) && ids.every((id) => typeof id === "string"),
      ),
    );
    const custom =
      raw.custom && typeof raw.custom === "object" && !Array.isArray(raw.custom)
        ? Object.fromEntries(
            Object.entries(raw.custom).filter(
              ([, text]) => typeof text === "string",
            ),
          )
        : {};
    const candidate = buildQuestionReply(questions, answers, custom);
    if (candidate.kind === "answered") reply = candidate;
  }
  return {
    requestId: record.requestId!,
    historyId: blockId,
    questions,
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(record.allowLateReply === true ? { allowLateReply: true } : {}),
    decision:
      reply || record.decision === "answered"
        ? "answered"
        : record.decision === "skipped"
          ? "skipped"
          : "cancelled",
    ...(reply ? { reply } : {}),
  };
}

export function recordQuestionAnswer(
  session: Session,
  answer: QuestionAnswer,
): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) => {
      if (block.id !== answer.blockId || !block.question) return block;
      const reply = buildQuestionReply(
        block.question.questions,
        answer.reply.answers,
        answer.reply.custom,
      );
      if (reply.kind !== "answered") return block;
      const question: UserQuestionRecord = {
        ...block.question,
        decision: "answered",
        reply,
        autoResolveAt: undefined,
      };
      return { ...block, question, text: questionTranscriptText(question) };
    }),
  };
}
