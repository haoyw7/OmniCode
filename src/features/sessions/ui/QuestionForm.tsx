import { Button } from "../../../shared/ui/forms/Button";
import { translate as translateUi } from "../../../shared/i18n/language";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  MessageSquare,
  Pencil,
  X,
} from "../../../shared/ui/icons";
import {
  CUSTOM_OPTION_ID,
  buildQuestionReply,
  isOtherOption,
  questionIsComplete,
  type UserQuestion,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../model/userQuestion";
import { useNow } from "../../../shared/hooks/useNow";

type Props = {
  prompt: UserQuestionPrompt;
  onReply: (requestId: number, reply: UserQuestionReply) => void;
  onInteraction?: (requestId: number) => void;
  /** Fold the form away without answering; the client can reopen it. */
  onCollapse?: () => void;
  /** "dock" is the desktop panel above the composer: numbered choices and a reply field. */
  variant?: "card" | "dock";
};

export function QuestionForm({
  prompt,
  onReply,
  onInteraction,
  onCollapse,
  variant = "card",
}: Props) {
  const { t: uiT } = useTranslation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const now = useNow(1000, prompt.autoResolveAt != null);
  const body = useRef<HTMLDivElement>(null);

  const interact = () => {
    if (prompt.autoResolveAt != null) onInteraction?.(prompt.requestId);
  };

  useEffect(() => {
    setStep(0);
    setAnswers({});
    setCustom(Object.fromEntries(prompt.questions.flatMap(question =>
      question.input ? [[question.id, question.input.initialValue ?? ""]] : [])));
  }, [prompt.requestId]);

  const questions = prompt.questions;
  const total = questions.length;
  const index = Math.min(step, Math.max(total - 1, 0));
  const question = questions[index];
  const last = index >= total - 1;
  const ready = useMemo(
    () => (question ? questionIsComplete(question, answers, custom) : false),
    [answers, custom, question],
  );

  const finish = (nextAnswers = answers, nextCustom = custom) => {
    onReply(
      prompt.requestId,
      buildQuestionReply(questions, nextAnswers, nextCustom),
    );
  };

  const skipCurrent = () => {
    if (!question) {
      finish();
      return;
    }
    const nextAnswers = { ...answers };
    const nextCustom = { ...custom };
    delete nextAnswers[question.id];
    delete nextCustom[question.id];
    if (last) {
      finish(nextAnswers, nextCustom);
      return;
    }
    setAnswers(nextAnswers);
    setCustom(nextCustom);
    setStep(index + 1);
  };

  const continueCurrent = () => {
    if (!question || !ready) return;
    if (last) {
      finish();
      return;
    }
    setStep(index + 1);
  };

  const goBack = () => {
    if (index > 0) setStep(index - 1);
  };

  const goForward = () => {
    if (!last) setStep(index + 1);
  };

  // Each step starts at its prompt, not wherever the previous one was scrolled.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [index]);

  if (!question) return null;

  const title = question.header?.trim() || prompt.title?.trim() || "Question";
  const captureInteraction = {
    onPointerDownCapture: interact,
    onClickCapture: interact,
    onKeyDownCapture: interact,
    onPasteCapture: interact,
    onChangeCapture: interact,
  };

  if (variant === "dock") {
    const header = question.header?.trim();
    const promptTitle = prompt.title?.trim();
    const label =
      header ||
      (promptTitle && promptTitle !== question.prompt.trim() ? promptTitle : "") ||
      uiT("Question");
    return (
      <div className="pb-2" data-question-form data-question-variant="dock" {...captureInteraction}>
        <form
          className="question-dock flex min-h-0 flex-col border px-4 pb-3 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            continueCurrent();
          }}
        >
          <div className="flex shrink-0 items-center gap-2 text-content/55">
            <CircleHelp className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {label}
            </span>
            {prompt.autoResolveAt != null ? (
              <span
                className="shrink-0 text-[11px] tabular-nums text-content/40"
                title={onInteraction ? uiT("Interact to keep this question open.") : undefined}
              >
                {uiT("Continues without an answer in {value0}s", {
                  value0: String(
                    Math.max(0, Math.ceil((prompt.autoResolveAt - now) / 1000)),
                  ),
                })}
              </span>
            ) : null}
            {total > 1 ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label={uiT("Previous question")}
                  title={uiT("Previous question")}
                  disabled={index === 0}
                  onClick={goBack}
                  className="grid size-6 place-items-center rounded-md hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                </button>
                <span className="px-1 text-[12px] tabular-nums text-content/45" aria-live="polite">
                  {index + 1} {uiT("of ")}
                  {total}
                </span>
                <button
                  type="button"
                  aria-label={uiT("Next question")}
                  title={uiT("Next question")}
                  disabled={last}
                  onClick={goForward}
                  className="grid size-6 place-items-center rounded-md hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {onCollapse ? (
              <button
                type="button"
                aria-label={uiT("Collapse question")}
                title={uiT("Collapse question")}
                className="-mr-1 grid size-7 shrink-0 place-items-center rounded-full hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
                onClick={onCollapse}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <DockQuestionFields
            key={question.id}
            bodyRef={body}
            question={question}
            selected={answers[question.id] ?? []}
            custom={custom[question.id] ?? ""}
            ready={ready}
            last={last}
            onSelect={(optionId) => {
              setAnswers((current) => ({
                ...current,
                [question.id]: nextSelection(question, current[question.id] ?? [], optionId),
              }));
              // A single choice replaces any reply written beside it.
              if (!question.multiSelect && question.options.length > 0)
                setCustom((current) => ({ ...current, [question.id]: "" }));
            }}
            onCustom={(value) => {
              setCustom((current) => ({ ...current, [question.id]: value }));
              if (question.options.length === 0) return;
              setAnswers((current) => {
                const id = customOptionId(question);
                const kept = question.multiSelect
                  ? (current[question.id] ?? []).filter((item) => !isCustomId(question, item))
                  : [];
                return {
                  ...current,
                  [question.id]: value.trim() ? [...kept, id] : kept,
                };
              });
            }}
            onSkip={skipCurrent}
          />
        </form>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-col px-1.5 pb-1.5"
      data-question-form
      {...captureInteraction}
    >
      <form
        className="flex min-h-0 flex-col rounded-lg border border-content/10 bg-content/3 px-3 py-2.5"
        data-question-card
        onSubmit={(event) => {
          event.preventDefault();
          continueCurrent();
        }}
      >
        <div className="flex shrink-0 items-center gap-1.5" data-question-header>
          <MessageSquare
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span
            className="min-w-0 flex-1 truncate text-[11px] text-content/50"
            data-question-title
          >
            {title}
          </span>
          {total > 1 ? (
            <div
              className="flex shrink-0 items-center gap-0.5"
              data-question-navigation
            >
              <button
                type="button"
                aria-label={uiT("Previous question")}
                title={uiT("Previous question")}
                disabled={index === 0}
                onClick={goBack}
                className="grid size-6 place-items-center rounded-md text-content/55 hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </button>
              <span
                className="px-1 text-[11px] tabular-nums text-content/40"
                aria-live="polite"
              >
                {index + 1} {uiT("of ")}
                {total}
              </span>
              <button
                type="button"
                aria-label={uiT("Next question")}
                title={uiT("Next question")}
                disabled={last}
                onClick={goForward}
                className="grid size-6 place-items-center rounded-md text-content/55 hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <Button variant="secondary"
            type="button"
            className="h-6 shrink-0 rounded-md px-1.5 text-[11px] text-content/55 hover:bg-content/6 hover:text-content"
            data-question-secondary
            onClick={skipCurrent}
          >
            {uiT("Skip")}
          </Button>
          {onCollapse ? (
            <button
              type="button"
              aria-label={uiT("Collapse question")}
              title={uiT("Collapse question")}
              className="grid size-6 shrink-0 place-items-center rounded-md text-content/55 hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
              data-question-collapse
              onClick={onCollapse}
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div
          ref={body}
          className="mt-2 min-h-0 overflow-y-auto"
          data-question-body
        >
          <QuestionFields
            key={question.id}
            question={question}
            selected={answers[question.id] ?? []}
            custom={custom[question.id] ?? ""}
            onSelect={(optionId) =>
              setAnswers((current) => ({
                ...current,
                [question.id]: nextSelection(
                  question,
                  current[question.id] ?? [],
                  optionId,
                ),
              }))
            }
            onCustom={(value) => {
              setCustom((current) => ({ ...current, [question.id]: value }));
              setAnswers((current) => {
                const selected = current[question.id] ?? [];
                if (question.multiSelect) {
                  const without = selected.filter(
                    (id) => !isCustomId(question, id),
                  );
                  return {
                    ...current,
                    [question.id]: [...without, customOptionId(question)],
                  };
                }
                return {
                  ...current,
                  [question.id]: [customOptionId(question)],
                };
              });
            }}
          />
        </div>
        <div
          className="mt-2.5 flex shrink-0 items-center justify-end gap-2"
          data-question-footer
        >
          {prompt.autoResolveAt != null ? (
            <span
              className="mr-auto text-[11px] tabular-nums text-content/40"
              data-question-hint
              title={onInteraction ? uiT("Interact to keep this question open.") : undefined}
            >
              {uiT("Continues without an answer in {value0}s", {
                value0: String(
                  Math.max(0, Math.ceil((prompt.autoResolveAt - now) / 1000)),
                ),
              })}
            </span>
          ) : null}
          {index > 0 ? (
            <Button variant="secondary"
              type="button"
              className="h-6 shrink-0 rounded-md px-1.5 text-[11px] text-content/55 hover:bg-content/6 hover:text-content"
              data-question-secondary
              onClick={goBack}
            >
              {uiT("Back")}
            </Button>
          ) : null}
          <Button variant="primary"
            type="submit"
            disabled={!ready}
            className="h-6 rounded-md bg-content px-2.5 text-[11px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
            data-question-submit
          >
            {uiT("Continue")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function QuestionFields({
  question,
  selected,
  custom,
  onSelect,
  onCustom,
}: {
  question: UserQuestion;
  selected: string[];
  custom: string;
  onSelect: (optionId: string) => void;
  onCustom: (value: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const options = displayOptions(question);
  const customSelected = selected.some((id) => isCustomId(question, id));
  const customId = customOptionId(question);
  const optionProps = useOptionNavigation(options, selected, onSelect);

  return (
    <fieldset
      className="min-w-0"
      aria-label={question.header || question.prompt}
    >
      <p
        className="text-[13px] font-medium leading-snug text-content"
        data-question-prompt
      >
        {question.prompt}
      </p>
      {question.multiSelect ? (
        <p className="mt-0.5 text-[11px] text-content/40" data-question-hint>
          {uiT("Select all that apply")}
        </p>
      ) : null}
      {options.length === 0 && question.allowCustom ? (
        question.input?.kind === "multiline" ? (
          <textarea data-ui="textarea"
            value={custom}
            onChange={(event) => onCustom(event.target.value)}
            placeholder={question.input.placeholder ?? uiT("Type your answer")}
            maxLength={question.input.maxLength}
            rows={5}
            aria-label={question.prompt}
            className="mt-1.5 w-full resize-y rounded-md border border-content/15 bg-transparent px-2 py-1 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-content/30"
          />
        ) : (
        <input data-ui="input"
          value={custom}
          onChange={(event) => onCustom(event.target.value)}
          placeholder={question.input?.placeholder ?? uiT("Type your answer")}
          maxLength={question.input?.maxLength}
          aria-label={question.prompt}
          className="mt-1.5 w-full rounded-md border border-content/15 bg-transparent px-2 py-1 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-content/30"
        />
        )
      ) : (
        <div
          className="mt-1.5 flex max-h-52 flex-col gap-1 overflow-y-auto"
          role="group"
          data-question-options
        >
          {options.map((option, optionIndex) => {
            const isCustom =
              isOtherOption(option) || option.id === CUSTOM_OPTION_ID;
            const active = selected.includes(option.id);
            return (
              <div key={option.id}>
                <button
                  {...optionProps(optionIndex)}
                  type="button"
                  aria-pressed={active}
                  data-question-option
                  className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                    active
                      ? "border-content/35 bg-selection"
                      : "border-content/10 hover:bg-content/3"
                  }`}
                >
                  <span
                    aria-hidden
                    data-question-mark
                    className={`mt-0.5 grid size-3.5 shrink-0 place-items-center border ${
                      question.multiSelect ? "rounded-[3px]" : "rounded-full"
                    } ${
                      active
                        ? "border-content bg-content text-background-base"
                        : "border-content/30"
                    }`}
                  >
                    {active ? (
                      <Check className="size-2.5" strokeWidth={2.5} />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-[12px] leading-snug text-content"
                      data-question-label
                    >
                      {option.label}
                    </span>
                    {option.description ? (
                      <span
                        className="mt-0.5 block text-[11px] leading-snug text-content/50"
                        data-question-description
                      >
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
                {isCustom && (active || customSelected) ? (
                  <input data-ui="input"
                    value={custom}
                    onChange={(event) => onCustom(event.target.value)}
                    placeholder={uiT("Type your answer")}
                    className="mt-1 w-full rounded-md border border-content/15 bg-transparent px-2 py-1 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-content/30"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => {
                      if (!customSelected) onSelect(customId);
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {question.input?.maxLength != null && custom.length > question.input.maxLength ? (
        <p role="alert" className="mt-1 text-[11px] text-content/60">
          {uiT("Answer exceeds the limit of {max} characters", { max: question.input.maxLength })}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Roving focus, arrow keys and 1-9 shortcuts shared by both layouts. */
function useOptionNavigation(
  options: UserQuestion["options"],
  selected: string[],
  onSelect: (optionId: string) => void,
) {
  const [highlighted, setHighlighted] = useState(() => {
    const selectedIndex = options.findIndex((option) =>
      selected.includes(option.id),
    );
    return selectedIndex >= 0 ? selectedIndex : 0;
  });
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);

  const highlight = (index: number) => {
    setHighlighted(index);
    optionButtons.current[index]?.focus();
  };

  const onOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      highlight((index + offset + options.length) % options.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      highlight(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(options[index].id);
      return;
    }

    const shortcut = Number(event.key);
    if (
      Number.isInteger(shortcut) &&
      shortcut >= 1 &&
      shortcut <= Math.min(options.length, 9)
    ) {
      event.preventDefault();
      const shortcutIndex = shortcut - 1;
      highlight(shortcutIndex);
      onSelect(options[shortcutIndex].id);
    }
  };

  return (index: number) => ({
    ref: (button: HTMLButtonElement | null) => {
      optionButtons.current[index] = button;
    },
    "aria-keyshortcuts": index < 9 ? String(index + 1) : undefined,
    "data-highlighted": highlighted === index ? "true" : undefined,
    tabIndex: highlighted === index ? 0 : -1,
    onFocus: () => setHighlighted(index),
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) =>
      onOptionKeyDown(event, index),
    onClick: () => {
      setHighlighted(index);
      onSelect(options[index].id);
    },
  });
}

function DockQuestionFields({
  bodyRef,
  question,
  selected,
  custom,
  ready,
  last,
  onSelect,
  onCustom,
  onSkip,
}: {
  bodyRef: RefObject<HTMLDivElement | null>;
  question: UserQuestion;
  selected: string[];
  custom: string;
  ready: boolean;
  last: boolean;
  onSelect: (optionId: string) => void;
  onCustom: (value: string) => void;
  onSkip: () => void;
}) {
  const { t: uiT } = useTranslation();
  const freeText = question.options.length === 0;
  const replyField = question.allowCustom || question.options.some(isOtherOption);
  // The reply field stands in for an "Other" choice.
  const options = replyField
    ? question.options.filter((option) => !isOtherOption(option))
    : question.options;
  const optionProps = useOptionNavigation(options, selected, onSelect);
  const fieldLabel = freeText ? question.prompt : uiT("Or write your own reply");
  const placeholder = freeText
    ? question.input?.placeholder ?? uiT("Type your answer")
    : uiT("Or write your own reply");
  const fieldClass =
    "min-w-0 flex-1 bg-transparent py-1 text-[14px] leading-5 text-content outline-none placeholder:text-content/40";

  return (
    <>
      <div
        ref={bodyRef}
        className="-mx-1.5 mt-2.5 max-h-[min(50vh,22rem)] min-h-0 overflow-x-hidden overflow-y-auto px-1.5"
      >
        <fieldset className="min-w-0" aria-label={question.header || question.prompt}>
          <p
            className="whitespace-pre-wrap break-words text-[14px] leading-[22px] text-content"
          >
            {question.prompt}
          </p>
          {question.multiSelect ? (
            <p className="mt-0.5 text-[12px] text-content/45">
              {uiT("Select all that apply")}
            </p>
          ) : null}
          {options.length ? (
            <div
              className="-mx-1.5 mt-2 flex flex-col gap-0.5"
              role="group"
            >
              {options.map((option, optionIndex) => {
                const active = selected.includes(option.id);
                return (
                  <button
                    key={option.id}
                    {...optionProps(optionIndex)}
                    type="button"
                    aria-pressed={active}
                    data-question-dock-option
                    className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-content/4 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
                  >
                    <span
                      aria-hidden
                      data-question-dock-mark
                      className="grid size-6 shrink-0 place-items-center rounded-md border text-[12px] tabular-nums"
                    >
                      {optionIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[14px] leading-5 text-content">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="mt-0.5 block break-words text-[12px] leading-[18px] text-content/50">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {question.input?.maxLength != null && custom.length > question.input.maxLength ? (
            <p role="alert" className="mt-1 text-[12px] text-content/60">
              {uiT("Answer exceeds the limit of {max} characters", { max: question.input.maxLength })}
            </p>
          ) : null}
        </fieldset>
      </div>
      <div className="mt-2 flex shrink-0 items-end gap-2">
        {replyField ? (
          <label className="flex min-w-0 flex-1 items-center gap-3 self-center">
            <Pencil className="size-4 shrink-0 text-content/40" strokeWidth={1.75} aria-hidden="true" />
            {question.input?.kind === "multiline" ? (
              <textarea
                value={custom}
                onChange={(event) => onCustom(event.target.value)}
                placeholder={placeholder}
                maxLength={question.input.maxLength}
                rows={3}
                aria-label={fieldLabel}
                className={`${fieldClass} resize-none`}
              />
            ) : (
              <input
                value={custom}
                onChange={(event) => onCustom(event.target.value)}
                placeholder={placeholder}
                maxLength={question.input?.maxLength}
                aria-label={fieldLabel}
                className={fieldClass}
              />
            )}
          </label>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          className="question-dock-skip h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium"
          onClick={onSkip}
        >
          {uiT("Skip")}
        </button>
        <button
          type="submit"
          disabled={!ready}
          className="question-dock-submit h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium"
        >
          {last ? uiT("Send") : uiT("Continue")}
        </button>
      </div>
    </>
  );
}

function displayOptions(question: UserQuestion): UserQuestion["options"] {
  if (question.options.length === 0) return question.options;
  if (question.options.some(isOtherOption) || !question.allowCustom) {
    return question.options;
  }
  return [
    ...question.options,
    { id: CUSTOM_OPTION_ID, label: translateUi("Other") },
  ];
}

function customOptionId(question: UserQuestion): string {
  return question.options.find(isOtherOption)?.id ?? CUSTOM_OPTION_ID;
}

function isCustomId(question: UserQuestion, optionId: string): boolean {
  return optionId === CUSTOM_OPTION_ID || optionId === customOptionId(question);
}

function nextSelection(
  question: UserQuestion,
  current: string[],
  optionId: string,
): string[] {
  if (!question.multiSelect) return [optionId];
  if (current.includes(optionId)) {
    return current.filter((id) => id !== optionId);
  }
  if (isCustomId(question, optionId)) {
    return [...current.filter((id) => !isCustomId(question, id)), optionId];
  }
  return [...current, optionId];
}
