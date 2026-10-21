import { Textarea } from "../../../shared/ui/forms/Textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { AttachmentList } from "../../sessions/ui/AttachmentList";
import { BotAttachmentPreview } from "./BotAttachmentPreview";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  BotChatChrome,
  BotComposerProps,
  BotControlsProps,
  BotHeaderProps,
  BotMessageMenuProps,
  BotSettingsPanelProps,
} from "./BotChatChrome";
import {
  AnimatedCollapse,
  useCollapseMotion,
} from "../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  ArrowLeft,
  ArrowUp,
  Pause,
  Play,
  Plus,
  Settings,
  Sparkles,
  Square,
  X,
} from "../../../shared/ui/icons";
import { ComposerNotice, ComposerNoticeButton } from "../../../shared/ui/ComposerNotice";
import { ExplorerMenu } from "../../connections/files/ui/ExplorerMenu";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

export function DesktopBotsMessageMenu({
  open,
  point,
  disabled,
  onReply,
  onClose,
}: BotMessageMenuProps) {
  const { t } = useTranslation();
  return <PresenceBoundary propagate>{open && point ? (
    <ExplorerMenu
      x={point.x}
      y={point.y}
      ariaLabel={t("Reply")}
      items={[{ kind: "item", id: "reply", label: t("Reply"), disabled }]}
      onPick={onReply}
      onClose={onClose}
    />
  ) : null}</PresenceBoundary>;
}

function DesktopBotsLegacyHeader({
  name,
  hostName,
  status,
  lifecycle,
  settingsOpen,
  busy,
  onSettings,
  onClose,
  controls,
}: BotHeaderProps) {
  const { t } = useTranslation();
  const toggleLabel = t(controls?.continuable ? "Continue" : "Pause");
  return (
    <header className="assistant-header">
      <div className="assistant-header-profile">
        <span className="assistant-avatar" aria-hidden="true">
          <Sparkles />
        </span>
        <div className="assistant-identity">
          <strong>{name}</strong>
          <span>
            <span title={hostName}>{hostName}</span>
            <span className="assistant-status" data-lifecycle={lifecycle}>
              {status}
            </span>
          </span>
        </div>
      </div>
      <div className="assistant-header-actions">
        {controls && (
          <>
            <IconButton
              type="button"
              className="assistant-icon-button"
              label={toggleLabel}
              disabled={busy}
              onClick={controls.onToggle}
            >
              {controls.continuable ? <Play /> : <Pause />}
            </IconButton>
            <IconButton
              type="button"
              className="assistant-icon-button assistant-danger"
              label={t("Disable assistant")}
              disabled={busy || !controls.enabled}
              onClick={controls.onDisable}
            >
              <Square />
            </IconButton>
          </>
        )}
        {onSettings && (
          <IconButton
            type="button"
            className="assistant-icon-button"
            label={t("Settings")}
            aria-expanded={settingsOpen}
            disabled={busy}
            onClick={onSettings}
          >
            <Settings />
          </IconButton>
        )}
        {onClose && (
          <IconButton
            type="button"
            className="assistant-icon-button"
            label={t("Close")}
            onClick={onClose}
          >
            <X />
          </IconButton>
        )}
      </div>
    </header>
  );
}

function DesktopBotsControls({
  nextRetryAt,
  backlog,
}: BotControlsProps) {
  const { t } = useTranslation();
  if (!nextRetryAt && !backlog) return null;
  return (
    <div className="assistant-notices" role="status">
      {nextRetryAt && (
        <span>
          {t("Next retry")}: {new Date(nextRetryAt).toLocaleTimeString()}
        </span>
      )}
      {backlog && (
        <span>
          {t("Some follow-ups are delayed while the assistant is busy.")}
        </span>
      )}
    </div>
  );
}

function DesktopBotsLegacySettingsPanel({
  open,
  initialSetup,
  onClose,
  children,
}: BotSettingsPanelProps) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const { foldState, finish } = useCollapseMotion(open);
  const page = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !visible) return;
    const previous = document.activeElement as HTMLElement | null;
    page.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected && !previous.closest("[inert]"))
        previous.focus({ preventScroll: true });
    };
  }, [open, visible]);
  if (!open && foldState === "closed") return null;
  const title = t(initialSetup ? "Set up assistant" : "Assistant settings");
  return (
    <motionElement.section
      initial={false} animate={{ x: open ? 0 : "100%", opacity: open ? 1 : 0 }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={finish}
      ref={page}
      className="assistant-settings-page"
      data-fold-state={foldState}
      aria-label={title}
      aria-hidden={!open || undefined}
      tabIndex={-1}
      inert={!open}

      onKeyDown={(e) => {
        if (e.key === "Escape" && !initialSetup) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="assistant-settings-header">
        {!initialSetup && (
          <IconButton
            type="button"
            className="assistant-icon-button"
            onClick={onClose}
            label={t("Back")}
          >
            <ArrowLeft />
          </IconButton>
        )}
        <strong>{title}</strong>
      </header>
      <div className="assistant-settings-content">{children}</div>
    </motionElement.section>
  );
}

export function DesktopBotsComposer({
  compact = false,
  draft,
  placeholder,
  errorNotice,
  jumpToBottom,
  onDraftChange,
  onSend,
  onStop,
  onAttach,
  onPaste,
  onDrop,
  onRemoveAttachment,
  attachments,
  busy,
  sending,
  inputDisabled,
  attachDisabled,
  sendDisabled,
  retry,
  onRetry,
}: BotComposerProps & { compact?: boolean }) {
  const { t } = useTranslation();
  const form = useForm({
    resolver: zodResolver(z.object({ draft: z.string().refine(value => !!value.trim() || attachments.length > 0, t("This field is required")) })),
    values: { draft },
  });
  const submit = form.handleSubmit(() => { if (!sendDisabled) onSend(); });
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const stoppable = !!onStop && !sending && !draft.trim() && !attachments.length;
  // Chips stay rendered while the tray collapses after the last removal.
  const [renderedAttachments, setRenderedAttachments] = useState(attachments);
  useLayoutEffect(() => {
    if (attachments.length) setRenderedAttachments(attachments);
  }, [attachments]);
  const [multiline, setMultiline] = useState(false);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const measure = () => {
      field.style.height = "0px";
      const height = field.scrollHeight;
      field.style.height = `${Math.min(Math.max(height, compact ? 20 : 24), compact ? 120 : 200)}px`;
      if (compact) setMultiline(height > 39);
    };
    measure();
    if (!compact || typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only width changes need another measurement; ignore our own height write.
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      measure();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [draft, compact]);
  return (
    <div className="assistant-compose-dock">
      {errorNotice}
      <AnimatedCollapse expanded={retry}>
        <ComposerNotice
          className="assistant-retry"
          size="compact"
          actions={
            <ComposerNoticeButton disabled={busy} onClick={onRetry}>
              {t("Retry message")}
            </ComposerNoticeButton>
          }
        >
          {t("Your last message was not delivered.")}
        </ComposerNotice>
      </AnimatedCollapse>
      <form
        className="assistant-compose"
        data-multiline={compact && multiline || undefined}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = attachDisabled ? "none" : "copy";
          }
        }}
        noValidate onSubmit={submit}
      >
        {jumpToBottom}
        <AnimatedCollapse expanded={!!attachments.length}>
          <AttachmentList
            className="assistant-attachments"
            aria-label={t("Attachments")}
            attachments={renderedAttachments}
            renderAttachment={file => <BotAttachmentPreview
              key={file.id}
              file={file}
              onRemove={busy || !attachments.length ? undefined : () => onRemoveAttachment(file.id)}
            />}
          />
        </AnimatedCollapse>
        <Textarea variant="editor"
          rows={1}
          aria-label={t("Message assistant")}
          placeholder={placeholder ?? t("Ask your assistant…")}
          {...form.register("draft", { onChange: (event) => onDraftChange(event.target.value) })}
          ref={(node) => { form.register("draft").ref(node); input.current = node; }}
          aria-invalid={!!form.formState.errors.draft}
          disabled={inputDisabled}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!sendDisabled) void submit();
            }
          }}
        />
        <div className="assistant-compose-actions">
          <IconButton
            type="button"
            className="assistant-icon-button"
            label={t("Attach files")}
            disabled={attachDisabled}
            onClick={() => files.current?.click()}
          >
            <Plus />
          </IconButton>
          <input
            ref={files}
            type="file"
            multiple
            className="assistant-file-input"
            tabIndex={-1}
            aria-hidden="true"
            disabled={attachDisabled}
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (selected.length) onAttach(selected);
            }}
          />
          <small className="assistant-compose-hint">
            {t("Enter to send · Shift+Enter for a new line")}
          </small>
          {stoppable ? (
            <IconButton shape="round"
              type="button"
              className="assistant-send"
              label={t("Stop")}
              disabled={busy}
              onClick={onStop}
            >
              <Square fill="currentColor" aria-hidden="true" />
            </IconButton>
          ) : <IconButton shape="round"
            type="submit"
            className="assistant-send"
            label={t(sending ? "Sending..." : "Send")}
            aria-busy={sending || undefined}
            disabled={sendDisabled}
          >
            {sending ? (
              <Spinner className="size-[18px]" aria-hidden="true" />
            ) : (
              <ArrowUp aria-hidden="true" />
            )}
          </IconButton>}
        </div>
        <FieldError errors={[form.formState.errors.draft]} />
      </form>
    </div>
  );
}

export const desktopBotsLegacyChrome: BotChatChrome = {
  Header: DesktopBotsLegacyHeader,
  Controls: DesktopBotsControls,
  SettingsPanel: DesktopBotsLegacySettingsPanel,
  Composer: DesktopBotsComposer,
};
