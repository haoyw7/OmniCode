import { RotatingIcon } from "../../../shared/ui/RotatingIcon";
import { motionGeometry } from "../../../shared/motion/tokens";
import { useContext, useState } from "react";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  MessageSquare,
} from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import type { QuestionAnswer, UserQuestionRecord } from "../model/userQuestion";
import { questionRecordAnswers } from "../model/questionHistory";
import { QuestionHistoryForm } from "./QuestionHistoryForm";
import { TranscriptPlatformContext } from "./TranscriptPlatform";

export function QuestionHistoryCard({
  blockId,
  question,
  pending,
  onAnswer,
}: {
  blockId: string;
  question: UserQuestionRecord;
  pending: boolean;
  onAnswer?: (
    answer: QuestionAnswer,
  ) => boolean | void | Promise<boolean | void>;
}) {
  const { t } = useTranslation();
  const { openQuestion, answeredQuestionsInline = true } = useContext(
    TranscriptPlatformContext,
  );
  const [open, setOpen] = useState(false);
  const canAnswer =
    question.allowLateReply &&
    !pending &&
    !question.reply &&
    question.decision !== "answered" &&
    !!onAnswer;
  // A pending question's card reopens the client's answer panel.
  const reopen = pending && !!openQuestion;
  const sheet = (canAnswer && !!openQuestion) || reopen;
  const answerable = canAnswer || reopen;
  const answered = !!question.reply || question.decision === "answered";
  const status = answered
    ? t("Answered")
    : pending
      ? t("Waiting for answers")
      : t("Not answered");
  // What was chosen, readable without opening the card.
  const reply = question.reply;
  const summary = reply
    ? question.questions
        .flatMap((item) => questionRecordAnswers(item, reply))
        .join(" · ")
    : "";
  const Icon = answered ? CircleCheck : MessageSquare;
  if (answered && answeredQuestionsInline)
    return (
      <div
        className="desktop-card question-history question-history-inline mx-4 my-2 space-y-3 rounded-xl border border-content/10 px-4 py-3 font-sans @md:mx-6"
        data-question-history={blockId}
      >
        {question.questions.map((item) => {
          const labels = reply ? questionRecordAnswers(item, reply) : [];
          return (
            <div key={item.id} className="min-w-0">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-content/55">
                {item.prompt}
              </p>
              <p
                className={`mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-5 ${
                  labels.length ? "font-medium text-content" : "text-content/45"
                }`}
              >
                {labels.length ? labels.join("\n") : t("Not answered")}
              </p>
            </div>
          );
        })}
      </div>
    );
  return (
    <div
      className="desktop-card question-history mx-4 my-2 overflow-hidden rounded-xl border border-content/10 bg-content/[0.025] font-sans @md:mx-6"
      data-question-history={blockId}
    >
      <button
        type="button"
        className="flex min-h-11 w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-content/3 motion-reduce:transition-none"
        aria-expanded={sheet ? undefined : open}
        aria-haspopup={sheet ? "dialog" : undefined}
        onClick={() => sheet ? openQuestion?.(blockId) : setOpen((value) => !value)}
      >
        <span
          className={`mt-px grid size-6 shrink-0 place-items-center rounded-full ${
            answered
              ? "bg-emerald-500/10 text-emerald-500"
              : answerable
                ? "bg-accent/10 text-accent"
                : "bg-content/[0.06] text-content/50"
          }`}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[11px] leading-4 ${
              answerable ? "font-medium text-accent" : "text-content/45"
            }`}
          >
            {answerable ? t("Answer question") : status}
          </span>
          <span className="mt-0.5 line-clamp-2 break-words text-[13px] leading-5 text-content/80">
            {question.title || question.questions[0]?.prompt || t("Question")}
          </span>
          {summary ? (
            <span className="mt-1.5 flex min-w-0 items-start gap-1.5 text-[12px] leading-[18px] text-content/60">
              <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" />
              <span className="line-clamp-2 min-w-0 break-words">{summary}</span>
            </span>
          ) : null}
        </span>
        {sheet ? (
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-content/40" />
        ) : (
          <RotatingIcon icon={ChevronDown} angle={open ? motionGeometry.flipAngle : 0} className="mt-1 size-3.5 shrink-0 text-content/40" />
        )}
      </button>
      <AnimatedCollapse expanded={open && !sheet}>
        {canAnswer && !sheet ? (
          <QuestionHistoryForm
            blockId={blockId}
            question={question}
            onAnswer={onAnswer!}
            onClose={() => setOpen(false)}
          />
        ) : (
          <div className="mx-3 space-y-3 border-t border-content/[0.08] py-3 text-[12px]">
            {question.questions.map((item) => {
              const labels = question.reply
                ? questionRecordAnswers(item, question.reply)
                : [];
              return (
                <div key={item.id}>
                  <p className="whitespace-pre-wrap font-medium text-content/80">
                    {item.prompt}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-content/65">
                    {labels.length
                      ? labels.join("\n")
                      : pending
                        ? t("Waiting for answers")
                        : t("Not answered")}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </AnimatedCollapse>
    </div>
  );
}
