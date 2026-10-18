import { Button } from "../../../shared/ui/forms/Button";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { immediateTransition, popAnimate, popExit, popInitial, popTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { CircleAlert, X } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { createPortal } from "react-dom";
import { allowsProjectNotification } from "../../notifications/model/notificationPreferences";
import { knownNotificationProject } from "../../notifications/model/notificationProjects";
import { useProjectNotificationPreferences } from "../../notifications/hooks/useProjectNotificationPreferences";
import type { ApprovalDecision } from "../../../integrations/harness";
import type { PendingApprovalNotice } from "../../notifications/model/approvalToast";
import { LAYER } from "../../../shared/lib/layers";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type Session,
} from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

type Notice = PendingApprovalNotice & { session: Session };

type Props = {
  notices: Notice[];
  focusedSessionId?: string;
  topOffset?: number;
  onFocusSession: (sessionId: string) => void;
  onApproval: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
};

export function ApprovalToasts({
  notices,
  focusedSessionId,
  onFocusSession,
  onApproval,
  topOffset = 12,
}: Props) {
  useProjectNotificationPreferences();
  // Preserve the original gate remount when a removed notice returns during exit.
  const previous = useRef(new Set<string>());
  const generations = useRef(new Map<string, number>());
  const keys = notices.map((notice) => `${notice.sessionId}:${notice.kind}:${notice.requestId}`);
  for (const key of keys) {
    if (!previous.current.has(key)) generations.current.set(key, (generations.current.get(key) ?? 0) + 1);
  }
  previous.current = new Set(keys);

  return createPortal(
    <div
      aria-live="polite"
      style={{ zIndex: LAYER.toast, top: topOffset }}
      className="pointer-events-none fixed right-3 flex w-[min(360px,calc(100vw-24px))] flex-col gap-2"
    >
      <AnimatePresence>
      {notices.map((notice) => (
        <ProjectApprovalToast
          key={`${notice.sessionId}:${notice.kind}:${notice.requestId}:${generations.current.get(`${notice.sessionId}:${notice.kind}:${notice.requestId}`)}`}
          notice={notice}
          focused={notice.sessionId === focusedSessionId}
          onFocusSession={onFocusSession}
          onApproval={onApproval}
        />
      ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function ProjectApprovalToast(props: {
  notice: Notice;
  focused: boolean;
  onFocusSession: Props["onFocusSession"];
  onApproval: Props["onApproval"];
}) {
  const reduced = useMotionPreference();
  const present = useIsPresent();
  const path = props.notice.session.cwd;
  // The keyed gate stays mounted even while hidden. Resuming notifications
  // must not turn a pending request into a new popup.
  const [occurredAt] = useState(Date.now);
  const [dismissed, setDismissed] = useState(props.focused);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const project = knownNotificationProject(path);
  const allowed = Boolean(
    project &&
    allowsProjectNotification({
      projectId: project.id,
      category: "agentInput",
      occurredAt,
    }),
  );
  const expanded = allowed && !props.focused && !dismissed;
  useEffect(() => {
    if (props.focused) setDismissed(true);
  }, [props.focused]);
  useEffect(() => {
    if (!expanded || hovered || focusWithin) return;
    const timer = window.setTimeout(() => setDismissed(true), 8000);
    return () => window.clearTimeout(timer);
  }, [expanded, hovered, focusWithin]);

  return (
    <motion.div initial={reduced ? false : popInitial} animate={popAnimate} exit={popExit} transition={reduced ? immediateTransition : popTransition} inert={!present} aria-hidden={!present || undefined}>
    <AnimatedCollapse expanded={expanded}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocusWithin(false);
        }}
      >
        <ApprovalToastCard
          {...props}
          onDismiss={() => setDismissed(true)}
          onFocusSession={(id) => {
            setDismissed(true);
            props.onFocusSession(id);
          }}
        />
      </div>
    </AnimatedCollapse>
    </motion.div>
  );
}

function ApprovalToastCard({
  notice,
  onFocusSession,
  onApproval,
  onDismiss,
}: {
  notice: Notice;
  onFocusSession: (sessionId: string) => void;
  onApproval: Props["onApproval"];
  onDismiss: () => void;
}) {
  const { t: uiT } = useTranslation();
  const { session, label, requestId } = notice;
  const title = sessionDisplayTitle(session.title, session.harness);
  const harness = HARNESS_TITLE[session.harness];

  const openSession = () => onFocusSession(session.id);

  return (
    <article
      className="approval-toast pointer-events-auto relative overflow-hidden rounded-xl border border-content/20 border-dashed bg-content/10 shadow-xl backdrop-blur-xl"
      role="status"
    >
      <button
        type="button"
        onClick={openSession}
        className="flex w-full flex-col gap-2 py-3 pl-3.5 pr-9 text-left hover:bg-content/3"
      >
        <span className="flex items-center gap-2">
          <HarnessIcon harness={session.harness} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug text-content">
            {title}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-400">
            <CircleAlert className="size-3.5" />
            <span>
              {notice.kind === "question" ? uiT("Question") : uiT("Approval")}
            </span>
          </span>
        </span>
        <span className="line-clamp-3 text-[12px] leading-relaxed text-content/70">
          {label}
        </span>
        <span className="text-[11px] text-content/40">{harness}</span>
      </button>
      <button
        type="button"
        aria-label={uiT("Close")}
        title={uiT("Close")}
        onClick={onDismiss}
        className="absolute right-1.5 top-2 rounded p-1 text-content/50 hover:bg-content/6 hover:text-content"
      >
        <X className="size-3.5" />
      </button>
      {notice.kind === "question" ? null : (
        <div className="flex gap-2 border-t border-stroke px-3.5 py-2.5">
          <Button variant="primary"
            type="button"
            data-approval="allow"
            className="flex-1 rounded-md bg-content px-2.5 py-1 text-[11px] font-medium text-background-base hover:bg-content/80"
            onClick={() => onApproval(session.id, requestId, "allow")}
          >
            {uiT("Allow")}
          </Button>
          <Button variant="secondary"
            type="button"
            data-approval="deny"
            className="flex-1 rounded-md bg-content/10 px-2.5 py-1 text-[11px] font-medium text-content/70 hover:bg-content/14"
            onClick={() => onApproval(session.id, requestId, "deny")}
          >
            {uiT("Deny")}
          </Button>
        </div>
      )}
    </article>
  );
}
