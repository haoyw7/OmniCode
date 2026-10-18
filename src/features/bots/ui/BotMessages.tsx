import { AttachmentList } from "../../sessions/ui/AttachmentList";
import { AttachmentChip } from "../../sessions/ui/AttachmentChip";
import type { RemoteAttachment } from "../../connections/model/protocol";
import { Fragment, memo, type HTMLAttributes, type ReactNode } from "react";
import type { BotMessage, SessionReference } from "../model/botView";
import { splitBotReply } from "../model/botReply";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { AfterTextReveal } from "../../sessions/ui/useTranscriptRenderingPlatform";
import { BotSessionCard } from "./BotSessionCard";
import {
  BotMessageMeta,
  BotMessageTime,
} from "./BotMessageMeta";
import { BotDateSeparator } from "./BotDateSeparator";
import { CornerDownRight } from "../../../shared/ui/icons";
import { BotMessageImage, type ReadBotImage } from "./BotMessageImage";

type MessageActions = {
  botsLayout?: boolean;
  renderFile?: (messageId: string, file: RemoteAttachment) => ReactNode;
  /** Optional desktop-only card; legacy/mobile status text stays unchanged. */
  renderBotDelegation?: (delegationId: string, revision: number) => ReactNode;
  readImage?: ReadBotImage;
  /** Opens a sent non-image file in its own tab, where the client has tabs. */
  onOpenAttachment?: (messageId: string, file: RemoteAttachment) => void;
  onOpen: (ref: SessionReference) => void;
  onRespond: (
    message: Extract<BotMessage, { kind: "input" }>,
    answer: object,
  ) => void;
  bindReply: (
    text: string,
    replyable?: boolean,
  ) => HTMLAttributes<HTMLDivElement>;
};

const BotMessageRow = memo(function BotMessageRow({
  message,
  previousCreatedAt,
  connected,
  connectNext,
  accessible,
  mobile,
  busy,
  pending,
  onOpen,
  onRespond,
  bindReply,
  readImage,
  onOpenAttachment,
  renderBotDelegation,
  renderFile,
  botsLayout,
}: MessageActions & {
  message: BotMessage;
  previousCreatedAt?: number;
  connected?: boolean;
  connectNext?: boolean;
  accessible: boolean;
  mobile: boolean;
  busy: boolean;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const reply = mobile && message.kind === "user"
    ? splitBotReply(message.text)
    : undefined;
  const files = "attachments" in message ? message.attachments ?? [] : [];
  const images = readImage ? files.filter(file => file.kind === "image") : [];
  // Other files share the image footprint above the bubble.
  const otherFiles = files.filter(file => !images.includes(file));
  const hasBubble = "text" in message && !!message.text;
  const time = mobile && (
    <BotMessageTime
      createdAt={message.createdAt}
      className="assistant-swipe-time"
    />
  );
  const wrapCard = (content: ReactNode) =>
    mobile ? (
      <div
        className={`assistant-message-row assistant-message-row-${message.kind}`}
      >
        {content}
        {time}
      </div>
    ) : (
      content
    );
  return (
    <Fragment key={message.id}>
      <BotDateSeparator
        createdAt={message.createdAt}
        previousCreatedAt={previousCreatedAt}
      />
      {!mobile && renderBotDelegation && message.kind === "status" &&
        "delegationId" in message && typeof message.delegationId === "string" ? (
        renderBotDelegation(message.delegationId, message.revision)
      ) : message.kind === "session-card" ? (
        wrapCard(
          <BotSessionCard
            key={message.id}
            message={message}
            onOpen={onOpen}
            accessible={accessible}
            mobile={mobile}
          />,
        )
      ) : message.kind === "input" ? (
        wrapCard(
          <article
            className="assistant-input"
            key={message.id}
            data-resolved={message.resolved || undefined}
          >
            <p>{message.text}</p>
            {message.resolved ? (
              <small className="assistant-pill">{t("Resolved")}</small>
            ) : message.inputKind === "question" && message.question ? (
              <QuestionForm
                prompt={message.question}
                onReply={(_request, reply) => onRespond(message, { reply })}
              />
            ) : (
              <div className="assistant-input-actions">
                {(["allow", "deny"] as const).map((decision) => (
                  <button
                    type="button"
                    key={decision}
                    className={
                      decision === "allow" ? "assistant-primary" : undefined
                    }
                    disabled={busy}
                    onClick={() => onRespond(message, { decision })}
                  >
                    {t(decision === "allow" ? "Allow" : "Deny")}
                  </button>
                ))}
              </div>
            )}
          </article>,
        )
      ) : (
        <div
          key={message.id}
          data-message-id={botsLayout ? message.id : undefined}
          data-connected={connected || undefined}
          data-connect-next={connectNext || undefined}
          className={`assistant-message-row assistant-message-row-${message.kind}`}
          data-reply-id={
            mobile && message.kind === "assistant" ? message.id : undefined
          }
        >
          {mobile && message.kind === "assistant" && (
            <span className="assistant-swipe-reply" aria-hidden="true">
              <CornerDownRight size={20} />
            </span>
          )}
          {reply && (
            <div className="assistant-message-reply-context" aria-label={t("Replying to")}>
              <CornerDownRight size={15} aria-hidden="true" />
              <span title={reply.quote}>{reply.quote}</span>
            </div>
          )}
          {files.length > 0 && (
            <AttachmentList
              className="assistant-message-media user-message-media"
              attachments={[...images, ...otherFiles]}
              renderAttachment={file => readImage && file.kind === "image"
                ? <BotMessageImage key={file.id} messageId={message.id} file={file} readImage={readImage} />
                : renderFile ? <Fragment key={file.id}>{renderFile(message.id, file)}</Fragment> : <AttachmentChip key={file.id} attachment={file} tile
                    onOpen={onOpenAttachment ? () => onOpenAttachment(message.id, file) : undefined} />}
            />
          )}
          {hasBubble && <div
            {...(message.kind === "assistant" ||
            (mobile && message.kind === "user")
              ? bindReply(message.text, message.kind === "assistant")
              : {})}
            className={`assistant-message assistant-message-${message.kind}`}
            data-streaming={
              (message.kind === "assistant" && message.streaming) || undefined
            }
          >
            {message.kind === "assistant" ? (
              <AgentMarkdown
                text={message.text}
                streaming={message.streaming}
                streamingKey={message.id}
                className="assistant-markdown"
                hardBreaks
              />
            ) : (
              <span>
                {message.kind === "status" ? t(message.text) : reply?.text ?? message.text}
              </span>
            )}
          </div>}
          {((message.kind === "assistant" && !mobile) ||
            message.kind === "user") && (
            <AfterTextReveal
              entries={message.kind === "assistant" ? [message] : []}
            >
              <BotMessageMeta
                text={message.text}
                createdAt={message.createdAt}
                mobile={mobile}
                read={
                  message.kind === "user" &&
                  pending &&
                  message.readAt !== undefined
                    ? message.readAt !== null
                    : undefined
                }
              />
            </AfterTextReveal>
          )}
          {time}
        </div>
      )}
    </Fragment>
  );
});

/** Draft/menu/header updates should not walk the conversation history. */
export const BotMessages = memo(function BotMessages({
  messages,
  pendingUserMessageId,
  canRead,
  allowedProjects,
  mobile,
  busy,
  ...actions
}: MessageActions & {
  messages: BotMessage[];
  pendingUserMessageId?: string;
  canRead: boolean;
  allowedProjects?: "all" | string[];
  mobile: boolean;
  busy: boolean;
}) {
  return messages.map((message, index) => (
    <BotMessageRow
      key={message.id}
      message={message}
      previousCreatedAt={messages[index - 1]?.createdAt}
      connected={actions.botsLayout && messages[index - 1]?.kind === message.kind && message.createdAt - messages[index - 1].createdAt < 60_000}
      connectNext={actions.botsLayout && messages[index + 1]?.kind === message.kind && messages[index + 1].createdAt - message.createdAt < 60_000}
      accessible={
        message.kind === "session-card" &&
        canRead &&
        (allowedProjects === "all" ||
          !!allowedProjects?.includes(message.ref.projectId))
      }
      mobile={mobile}
      busy={message.kind === "input" && busy}
      pending={message.id === pendingUserMessageId}
      {...actions}
    />
  ));
});
