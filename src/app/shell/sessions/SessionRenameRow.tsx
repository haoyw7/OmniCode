import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { sessionDisplayTitle } from "../../../features/sessions/model/session";
import type { SessionSummary } from "../../../features/sessions/data/sessionStore";



export function SessionRenameRow({
  session,
  projectLabel,
  isActive,
  needsApproval,
  dense = false,
  compact = false,
  onCommit,
  onCancel,
}: {
  session: SessionSummary;
  projectLabel?: string;
  isActive: boolean;
  needsApproval: boolean;
  dense?: boolean;
  compact?: boolean;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(() =>
    sessionDisplayTitle(session.title, session.harness),
  );

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      finished.current = true;
      onCommit(trimmed);
      return;
    }
    finished.current = true;
    onCancel();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };

  return (
    <div
      data-session-rename-row={session.id}
      data-session-layout={dense && projectLabel !== undefined ? "two-line" : undefined}
      className={`flex w-full rounded-lg ${dense ? `h-8 items-center ${compact ? "pl-[46px] pr-2" : "pl-6 pr-2"}` : "flex-col px-2.5 py-2"} ${
        needsApproval
          ? "bg-amber-400/10 text-content"
          : isActive
            ? "bg-selection text-content"
            : "text-content/80"
      }`}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded bg-content/10 px-2 py-1 text-ui-caption font-semibold leading-snug text-content outline-none ring-1 ring-accent/40"
      />
      {dense && projectLabel !== undefined ? (
        <span data-session-project>{projectLabel}</span>
      ) : null}
    </div>
  );
}
