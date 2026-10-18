import { Button } from "../shared/ui/forms/Button";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Archive,
  Copy,
  ChevronRight,
  CircleDot,
  Bot,
  GitBranch,
  Pencil,
  Pin,
  Trash2,
} from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import type {
  HostSession,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { sessionDisplayTitle } from "../features/sessions/model/session";
import { MobileSheet, SHEET_WIDTH, type MobileSheetPoint } from "./MobileSheet";
import { mobileTranscriptPlatform } from "./transcriptPlatform";
import type { MobileSessionPatch } from "./client";

export function MobileSessionActions({
  open = true,
  onExited,
  snapshot,
  summary,
  anchor,
  anchorPoint,
  disabled,
  onUpdate,
  onDelete,
  onMarkUnread,
  onDelegate,
  onClose,
}: {
  open?: boolean;
  onExited?: () => void;
  snapshot?: HostSession;
  summary?: HostSessionSummary;
  anchor: RefObject<HTMLElement | null>;
  anchorPoint?: MobileSheetPoint;
  disabled: boolean;
  onUpdate: (patch: MobileSessionPatch) => Promise<void>;
  onDelete?: () => Promise<void>;
  onMarkUnread?: () => Promise<void>;
  onDelegate?: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<
    "menu" | "rename" | "copy" | "delete"
  >("menu");
  const [title, setTitle] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (open) {
      setPage("menu");
      setError("");
    }
  }, [open]);
  const blocked = disabled || working;
  const session = summary ?? snapshot?.session;
  const pinned = summary?.pinned ?? snapshot?.pinned;
  const archived = summary?.archived ?? snapshot?.archived;
  const running = (summary?.status ?? snapshot?.status) === "running";
  const branch = summary?.branch;
  const run = async (action: () => Promise<void>) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? t(problem.message)
          : t("Unable to update this conversation."),
      );
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };
  const close = () => {
    if (!inFlight.current) onClose();
  };
  const back = () => {
    if (!inFlight.current) {
      setError("");
      setPage("menu");
    }
  };
  const copy = (value: string) =>
    void run(() => mobileTranscriptPlatform.copyText(value));
  return (
    <MobileSheet
      key={page}
      open={open}
      onExited={onExited}
      title={
        page === "rename"
          ? "Rename"
          : page === "copy"
            ? "Copy session ID"
            : page === "delete"
              ? "Delete session"
              : "Session actions"
      }
      placement="anchor"
      anchor={anchor}
      anchorPoint={anchorPoint}
      width={
        page === "menu" || page === "copy" ? SHEET_WIDTH.menu : SHEET_WIDTH.form
      }
      align={anchorPoint ? "start" : "end"}
      onClose={close}
      onBack={page === "menu" ? undefined : back}
    >
      <div className={`mobile-session-actions${summary ? " mobile-sidebar-session-actions" : ""}`}>
        {page === "menu" ? (
          <>
            {summary && <p className="mobile-session-menu-title">{sessionDisplayTitle(summary.title, summary.harness) || t("Untitled conversation")}</p>}
            {session && (
              <>
                {onDelegate && (
                  <button className="mobile-sheet-row" disabled={blocked} onClick={() => void run(onDelegate)}>
                    <Bot size={20} />
                    <span>{t("Hand over to assistant")}</span>
                  </button>
                )}
                {branch && (
                  <button
                    className="mobile-sheet-row"
                    disabled={blocked}
                    onClick={() => copy(branch)}
                  >
                    <GitBranch size={20} />
                    <span className="mobile-sheet-row-text">
                      <span>{t("Copy branch")}</span>
                      <small>{branch}</small>
                    </span>
                  </button>
                )}
                {branch && (
                  <div className="mobile-menu-divider" role="separator" />
                )}
                <button
                  className="mobile-sheet-row"
                  disabled={blocked}
                  onClick={() =>
                    void run(() => onUpdate({ pinned: !pinned }))
                  }
                >
                  <Pin size={20} />
                  <span>{t(pinned ? "Unpin" : "Pin")}</span>
                </button>
                {onMarkUnread && (
                  <button
                    className="mobile-sheet-row"
                    disabled={blocked}
                    onClick={() => void run(onMarkUnread)}
                  >
                    <CircleDot size={20} />
                    <span>{t("Mark as unread")}</span>
                  </button>
                )}
                <button
                  className="mobile-sheet-row"
                  disabled={blocked}
                  onClick={() =>
                    summary ? copy(session.id) : setPage("copy")
                  }
                >
                  <Copy size={20} />
                  <span>{t("Copy session ID")}</span>
                  {!summary && <ChevronRight size={18} />}
                </button>
                <button
                  className="mobile-sheet-row"
                  disabled={blocked}
                  onClick={() => {
                    setTitle(
                      sessionDisplayTitle(session.title, session.harness),
                    );
                    setPage("rename");
                  }}
                >
                  <Pencil size={20} />
                  <span>{t("Rename")}</span>
                </button>
                <div className="mobile-menu-divider" role="separator" />
                <button
                  className={`mobile-sheet-row${archived ? "" : " mobile-menu-danger"}`}
                  disabled={blocked}
                  onClick={() =>
                    void run(() => onUpdate({ archived: !archived }))
                  }
                >
                  <Archive size={20} />
                  <span>{t(archived ? "Unarchive" : "Archive")}</span>
                </button>
                {onDelete && (
                  <button
                    className="mobile-sheet-row mobile-menu-danger"
                    disabled={blocked || running}
                    title={
                      running
                        ? t("Stop this session before deleting it")
                        : undefined
                    }
                    onClick={() => setPage("delete")}
                  >
                    <Trash2 size={20} />
                    <span>{t("Delete")}</span>
                  </button>
                )}
              </>
            )}
          </>
        ) : page === "copy" && session ? (
          <>
            <button
              className="mobile-sheet-row"
              disabled={blocked || !session.providerSessionId}
              onClick={() =>
                session.providerSessionId && copy(session.providerSessionId)
              }
            >
              <span>{t("Harness session ID")}</span>
            </button>
            <button
              className="mobile-sheet-row"
              disabled={blocked}
              onClick={() => copy(session.id)}
            >
              <span>{t("OmniCode session ID")}</span>
            </button>
          </>
        ) : page === "rename" ? (
          <form
            className="mobile-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim())
                void run(() => onUpdate({ title: title.trim() }));
            }}
          >
            <label>
              {t("Session title")}
              <input data-ui="input"
                value={title}
                maxLength={200}
                disabled={blocked}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="mobile-menu-form-buttons">
              <Button variant="secondary"
                type="button"

                disabled={blocked}
                onClick={back}
              >
                {t("Cancel")}
              </Button>
              <Button variant="primary"
                type="submit"

                disabled={blocked || !title.trim()}
              >
                {t("Save")}
              </Button>
            </div>
          </form>
        ) : page === "delete" && onDelete ? (
          <>
            <p className="mobile-muted">
              {t("Delete this conversation? This can’t be undone.")}
            </p>
            <div className="mobile-menu-form-buttons">
              <Button variant="secondary"
                type="button"

                disabled={blocked}
                onClick={back}
              >
                {t("Cancel")}
              </Button>
              <Button variant="danger"
                type="button"
                className="mobile-menu-danger"
                disabled={blocked || running}
                onClick={() => void run(onDelete)}
              >
                {t("Delete")}
              </Button>
            </div>
          </>
        ) : null}
        {error && (
          <p className="mobile-form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </MobileSheet>
  );
}
