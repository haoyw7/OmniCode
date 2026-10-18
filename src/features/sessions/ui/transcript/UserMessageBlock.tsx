import { Button } from "../../../../shared/ui/forms/Button";
import { DetailsChevron } from "../../../../shared/ui/DetailsChevron";
import { timestampTitle } from "../timestampTitle";
import { AttachmentList } from "../AttachmentList";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { ArrowUp, CircleDashed, Bot, Trash2 } from "../../../../shared/ui/icons";
import { useLayoutEffect, useRef, useState } from "react";
import { AttachmentChip } from "../AttachmentChip";
import { MonocodeSparkles } from "../MonocodeSparkles";
import { OrchestratorConstellation } from "../OrchestratorConstellation";
import { PlanStepsBurst } from "../PlanStepsBurst";
import { SecondOpinionCard } from "../SecondOpinionCard";
import { NoteMiniCard } from "../../../notes/ui/NoteMiniCard";
import { visibleUserPrompt } from "../../../orchestration/model/orchestration";
import { type Block } from "../../model/session";
import type { TranscriptLayout } from "../../../settings/model/appearance";
import { CopyTurnButton } from "../CopyTurnButton";
import { parseUserMessageLink } from "../../model/linkPreview";
import { isAttachmentFolder } from "../../model/attachments";
import { UserLinkPreview } from "../UserLinkPreview";
import { isOperatorUserTurn, operatorUserPrompt } from "../../model/operatorCommand";
import { EditLastTurnButton, SaveNoteButton } from "./TurnActions";
import { formatClockTime } from "./transcriptClock";



export function UserMessageBlock({
  block,
  layout,
  visible,
  stickyIndex,
  onEdit,
  editing = false,
  cwd,
  onSaveNote,
  onSendDraft,
  onRemoveDraft,
  onOpenFile,
}: {
  block: Block;
  layout: TranscriptLayout;
  visible: boolean;
  stickyIndex: number;
  onEdit?: () => void;
  editing?: boolean;
  cwd?: string;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  onOpenFile?: (path: string) => void;
}) {
  const { t: uiT, language } = useTranslation();
  const sentAt = block.sentAt ?? block.startedAt;
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLElement>(null);
  const card = block.secondOpinion;
  const note = block.noteCard;
  const monocode = isOperatorUserTurn(block);
  const text =
    card && card.kind !== "handoff"
      ? ""
      : visibleUserPrompt(monocode ? operatorUserPrompt(block) : block.text);
  const messageLink = text ? parseUserMessageLink(text) : null;
  const displayText = messageLink
    ? `${messageLink.beforeText}${messageLink.afterText}`
    : text;
  // Sent attachments sit above the caption as image-sized tiles, using the
  // same presentation on desktop and mobile. Drafts keep theirs inside the
  // editable card.
  const mediaAttachments = !block.draft ? (block.attachments ?? []) : [];
  const bubbleAttachments = mediaAttachments.length
    ? (block.attachments ?? []).filter(
        (file) => !mediaAttachments.includes(file),
      )
    : (block.attachments ?? []);
  const hasBubble = Boolean(
    text ||
    bubbleAttachments.length ||
    card ||
    note ||
    block.ciContext ||
    block.draft,
  );
  useLayoutEffect(() => {
    if (!visible) return;
    const el = textRef.current;
    if (!el || !text) {
      setOverflows(false);
      return;
    }

    const measure = () => {
      // Reading a descendant's size makes the browser lay out an otherwise
      // skipped historical turn. Leave it skipped until it comes into view.
      if (
        !el.isConnected ||
        (el.checkVisibility &&
          !el.checkVisibility({ contentVisibilityAuto: true }))
      )
        return;
      if (!expanded) {
        setOverflows(el.scrollHeight > el.clientHeight + 1);
      }
    };

    const turn = el.closest(".transcript-turn");
    const onVisible = (event: Event) => {
      if (!(event as ContentVisibilityAutoStateChangeEvent).skipped) measure();
    };
    turn?.addEventListener("contentvisibilityautostatechange", onVisible);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      turn?.removeEventListener("contentvisibilityautostatechange", onVisible);
    };
  }, [text, expanded, visible]);

  const toggle = () => {
    if (overflows) setExpanded((value) => !value);
  };

  return (
    <div
      data-prompt-anchor={block.id}
      data-sending={block.sending ? "true" : undefined}
      data-message-layout={layout}
      data-editing-last-turn={editing ? "true" : undefined}
      className="user-message-row group/usermsg flex flex-col items-end overflow-visible pt-1 pr-4 @md:pr-6 pb-5 pl-[18%]"
    >
      <div className="user-message-hover-zone flex w-fit max-w-full min-w-0 flex-col items-end overflow-visible">
        {block.origin?.kind === "assistant" && (
          <div
            className="mb-1 inline-flex items-center gap-1.5 px-3 text-xs text-content/60"
            data-assistant-origin={block.origin.assistantId}
          >
            <Bot className="size-3.5" aria-hidden="true" />
            <span>{uiT("From {value0}", { value0: block.origin.assistantName || uiT("Assistant") })}</span>
          </div>
        )}
        {mediaAttachments.length ? (
          <AttachmentList
            attachments={mediaAttachments}
            className={`user-message-media flex max-w-[min(100%,36rem)] flex-wrap justify-end gap-1.5 ${hasBubble ? "mb-1.5" : ""}`}
            renderAttachment={(file) => (
              <AttachmentChip
                key={file.id}
                attachment={file}
                tile
                onOpen={
                  onOpenFile && file.path && !isAttachmentFolder(file)
                    ? () => onOpenFile(file.path!)
                    : undefined
                }
              />
            )}
          />
        ) : null}
        <div
          hidden={!hasBubble}
          data-bubble-layout={layout}
          data-draft={block.draft ? "true" : undefined}
          data-monocode={monocode ? "true" : undefined}
          className={`user-message-bubble relative w-fit min-w-0 px-3 py-2 font-sans text-content transition-[background-color] duration-200 ${
            layout === "chat" ? "max-w-[min(100%,36rem)]" : "max-w-full"
          } ${
            block.draft
              ? "border border-dashed border-content/30 bg-content/4"
              : "bg-content/10"
          } ${editing ? "edit-last-turn-bubble" : ""}`}
          style={{ zIndex: stickyIndex }}
        >
          {bubbleAttachments.length ? (
            <div
              className={`flex flex-wrap gap-1.5 ${text || card || note ? "mb-2" : ""}`}
            >
              {bubbleAttachments.map((file) => (
                <AttachmentChip key={file.id} attachment={file} />
              ))}
            </div>
          ) : null}
          {note ? (
            <div className={text || card ? "mb-2" : ""}>
              <NoteMiniCard card={note} embedded />
            </div>
          ) : null}
          {card ? (
            <div className={text ? "mb-1.5" : undefined}>
              <SecondOpinionCard card={card} />
            </div>
          ) : null}
          {messageLink ? (
            <div
              ref={(element) => {
                textRef.current = element;
              }}
              className="user-message-with-link min-w-0 whitespace-pre-wrap break-words font-sans text-sm"
              data-selectable-agent-response={block.id}
            >
              {messageLink.beforeText}
              <UserLinkPreview link={messageLink.link} cwd={cwd} compact />
              {messageLink.afterText}
            </div>
          ) : displayText ? (
            <pre
              data-selectable-agent-response={block.id}
              ref={(element) => {
                textRef.current = element;
              }}
              className={`min-w-0 whitespace-pre-wrap break-words font-sans text-sm ${expanded ? "" : "line-clamp-4"}`}
            >
              {displayText}
            </pre>
          ) : null}
          {overflows ? (
            <button
              type="button"
              aria-expanded={expanded}
              className="mt-1 rounded px-1 py-0.5 text-xs text-content/60 hover:bg-content/5 hover:text-content"
              onClick={toggle}
            >
              {expanded ? uiT("Show less") : uiT("Show more")}
            </button>
          ) : null}
          {block.ciContext ? (
            <details
              className="group/ci mt-2 min-w-0 border-t border-content/10 pt-2"
              onClick={(event) => event.stopPropagation()}
            >
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs text-content/50 transition-colors hover:text-content/80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-content/40 [&::-webkit-details-marker]:hidden">
                <DetailsChevron className="size-3 shrink-0" />
                <span>{uiT("CI context")}</span>
              </summary>
              <p className="mt-2 text-xs text-content/50">
                {uiT(
                  "CI instructions and failure details included with this request.",
                )}
              </p>
              <pre className="mt-2 max-h-72 min-w-0 overflow-auto overscroll-contain rounded-md bg-content/5 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-content/70">
                {block.ciContext}
              </pre>
            </details>
          ) : null}
          {block.draft ? (
            <div className="mt-2 flex items-center justify-between gap-4 border-t border-dashed border-content/20 pt-2">
              <span className="flex items-center gap-1.5 text-xs text-content/50">
                <CircleDashed className="size-3.5" />
                {uiT("Draft")}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  title={uiT("Remove draft")}
                  aria-label={uiT("Remove draft")}
                  onClick={() => onRemoveDraft?.(block)}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-content/55 hover:bg-content/6 hover:text-content"
                >
                  <Trash2 className="size-3.5" />
                  {uiT("Remove")}
                </button>
                <Button variant="primary"
                  type="button"
                  title={uiT("Send draft")}
                  aria-label={uiT("Send draft")}
                  onClick={() => onSendDraft?.(block)}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-transform duration-150 active:scale-[0.97]"
                >
                  {uiT("Send")}
                  <ArrowUp className="size-3.5" strokeWidth={2.25} />
                </Button>
              </span>
            </div>
          ) : null}
          {monocode ? (
            <MonocodeSparkles blockId={block.id} startedAt={block.startedAt} />
          ) : block.intent === "plan" ? (
            <PlanStepsBurst blockId={block.id} startedAt={block.startedAt} />
          ) : block.intent === "orchestrate" ? (
            <OrchestratorConstellation
              blockId={block.id}
              startedAt={block.startedAt}
            />
          ) : null}
        </div>
        {!block.sending &&
        (text ||
        block.attachments?.length ||
        sentAt != null ||
        onEdit) ? (
          <div className="user-message-actions flex items-center gap-1 px-3 pt-1">
            {onEdit ? (
              <EditLastTurnButton onEdit={onEdit} editing={editing} />
            ) : null}
            {text && onSaveNote ? (
              <SaveNoteButton text={text} onSave={onSaveNote} />
            ) : null}
            {sentAt != null ? (
              <time
                dateTime={new Date(sentAt).toISOString()}
                title={timestampTitle(sentAt, language)}
                className="ml-1 font-sans text-xs text-content/40"
              >
                {formatClockTime(sentAt)}
              </time>
            ) : null}
            {text || block.attachments?.length ? (
              <CopyTurnButton
                text={text}
                attachments={block.attachments}
                label={uiT("Copy message")}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
