import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FieldError } from "../shared/ui/primitives/Field";
import { Button } from "../shared/ui/forms/Button";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
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
  onMarkUnread?: () => Promise<void>;
  onDelegate?: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<"menu" | "rename" | "copy">("menu");
  const form = useForm({
    resolver: zodResolver(z.object({ title: z.string().trim().min(1, t("Enter a name")).max(200, t("Use at most {count} characters", { count: 200 })) })),
    defaultValues: { title: "" },
  });
  const title = useWatch({ control: form.control, name: "title" });
  const setTitle = (title: string) => form.reset({ title });
  const mutation = useMutation({ mutationFn: (action: () => Promise<void>) => action() }, queryClient);
  const working = mutation.isPending;
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
  const branch = summary?.branch;
  const run = async (action: () => Promise<void>) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setError("");
    try {
      await mutation.mutateAsync(action);
      onClose();
    } catch (problem) {
      toast.error(problem instanceof Error ? t(problem.message) : t("Unable to update this conversation."));
      setError(
        problem instanceof Error
          ? t(problem.message)
          : t("Unable to update this conversation."),
      );
    } finally {
      inFlight.current = false;
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
                  <button className="hover:opacity-80 active:opacity-70 mobile-sheet-row" disabled={blocked} onClick={() => void run(onDelegate)}>
                    <Bot />
                    <span>{t("Hand over to assistant")}</span>
                  </button>
                )}
                {branch && (
                  <button
                    className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                    disabled={blocked}
                    onClick={() => copy(branch)}
                  >
                    <GitBranch />
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
                  className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                  disabled={blocked}
                  onClick={() =>
                    void run(() => onUpdate({ pinned: !pinned }))
                  }
                >
                  <Pin />
                  <span>{t(pinned ? "Unpin" : "Pin")}</span>
                </button>
                {onMarkUnread && (
                  <button
                    className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                    disabled={blocked}
                    onClick={() => void run(onMarkUnread)}
                  >
                    <CircleDot />
                    <span>{t("Mark as unread")}</span>
                  </button>
                )}
                <button
                  className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                  disabled={blocked}
                  onClick={() =>
                    summary ? copy(session.id) : setPage("copy")
                  }
                >
                  <Copy />
                  <span>{t("Copy session ID")}</span>
                  {!summary && <ChevronRight />}
                </button>
                <button
                  className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                  disabled={blocked}
                  onClick={() => {
                    setTitle(
                      sessionDisplayTitle(session.title, session.harness),
                    );
                    setPage("rename");
                  }}
                >
                  <Pencil />
                  <span>{t("Rename")}</span>
                </button>
                <div className="mobile-menu-divider" role="separator" />
                <button
                  className={`hover:opacity-80 active:opacity-70 mobile-sheet-row${archived ? "" : " mobile-menu-danger"}`}
                  disabled={blocked}
                  onClick={() =>
                    void run(() => onUpdate({ archived: !archived }))
                  }
                >
                  <Archive />
                  <span>{t(archived ? "Unarchive" : "Archive")}</span>
                </button>
              </>
            )}
          </>
        ) : page === "copy" && session ? (
          <>
            <button
              className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
              disabled={blocked || !session.providerSessionId}
              onClick={() =>
                session.providerSessionId && copy(session.providerSessionId)
              }
            >
              <span>{t("Harness session ID")}</span>
            </button>
            <button
              className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
              disabled={blocked}
              onClick={() => copy(session.id)}
            >
              <span>{t("OmniCode session ID")}</span>
            </button>
          </>
        ) : page === "rename" ? (
          <form
            className="mobile-form"
            noValidate onSubmit={form.handleSubmit(({ title }) => run(() => onUpdate({ title })))}
          >
            <label>
              {t("Session title")}
              <input data-ui="input"
                {...form.register("title")}
                aria-invalid={!!form.formState.errors.title}
                maxLength={200}
                disabled={blocked}
              />
            </label>
            <FieldError errors={[form.formState.errors.title]} />
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
