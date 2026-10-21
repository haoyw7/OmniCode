import { cn } from "../../../../../shared/lib/cn";
import { Button } from "../../../../../shared/ui/forms/Button";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import {
  Bot,
  ChevronRight,
  CircleHelp,
  File,
  Globe,
  PenLine,
  Search,
  Terminal,
  WandSparkles,
  Wrench,
  X,
} from "../../../../../shared/ui/icons";
import type { ReactNode } from "react";
import type { ApprovalDecision } from "../../../../../integrations/harness";
import { FileTypeIcon } from "../../../../connections/files/ui/FileTypeIcon";
import type { Block, ToolPreview } from "../../../model/session";
import {
  resolveToolCallDisplay,
  type ToolCallState,
} from "../../../model/transcriptActivity";
import type { ToolRendererKind } from "../../../model/toolRenderer";

/** The pieces every tool row is built from: icons, the summary line, approval. */

export function ToolKindIcon({
  renderer,
  state,
  live = false,
}: {
  renderer: ToolRendererKind;
  state: ToolCallState;
  live?: boolean;
}) {
  const Icon = {
    omnicode: Terminal,
    agent: Bot,
    question: CircleHelp,
    skill: WandSparkles,
    edit: PenLine,
    read: File,
    search: Search,
    execute: Terminal,
    mcp: Globe,
    generic: Wrench,
  }[renderer];
  return (
    <Icon
      aria-hidden="true"
      strokeWidth={1.75}
      className={cn("size-3.5 shrink-0", state === "rejected" ? "text-danger" : "text-content/45", live && state === "pending" ? "zen-thinking-pulse" : "")}
    />
  );
}

/** Failure stays marked. Running and success do not get a trailing icon. */
export function ToolCallStatusIcon({ state }: { state: ToolCallState }) {
  if (state === "rejected") {
    return <X className="size-3.5 shrink-0 text-danger" />;
  }
  return null;
}

/**
 * A tool row that opens the client's detail view. File targets inside keep
 * their own buttons, so this is a role=button wrapper rather than a <button>.
 */
export function ToolOpenRow({
  block,
  label,
  className,
  onOpen,
  children,
}: {
  block: Block;
  label: string;
  className: string;
  onOpen: (block: Block) => void;
  children: ReactNode;
}) {
  const { t: uiT } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={uiT("Show tool details: {value0}", { value0: label })}
      data-tool-open-row=""
      className={cn("hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70", cn("group", className, "cursor-pointer"))}
      onClick={() => onOpen(block)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen(block);
      }}
    >
      {children}
      <ChevronRight className="zen-disclosure-chevron size-3.5 shrink-0" />
    </div>
  );
}

export function ToolCallSummary({
  label,
  preview,
  cwd,
  onOpenFile,
  onOpenDiff,
  interactive = true,
  chip = false,
  failed = false,
}: {
  label: string;
  preview?: ToolPreview;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  interactive?: boolean;
  /** Sets the file off in a chip, for rows that lean on a rail for structure. */
  chip?: boolean;
  failed?: boolean;
}) {
  const { t: uiT } = useTranslation();
  const { action, target, fileName, filePath, isFile } =
    resolveToolCallDisplay(label, preview, cwd);
  if (!action || !target) {
    return (
      <span
        className={cn("min-w-0 flex-1 truncate font-mono text-ui-caption", failed ? "text-danger" : chip ? "text-content/65" : "text-content/80")}
        title={label}
      >
        {label}
      </span>
    );
  }
  const openFile =
    action === "Edit" || action === "Write"
      ? (onOpenDiff ?? onOpenFile)
      : onOpenFile;
  const canOpen = interactive && !!openFile && !!filePath;
  const actionTone = failed ? "text-danger" : "text-foreground-subtlest";
  const targetTone = failed
    ? "text-danger"
    : chip
      ? "text-content/70"
      : "text-content/85";

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-ui-caption">
      <span className={cn("shrink-0 font-sans text-sm", actionTone)}>
        {action}
      </span>
      {isFile ? (
        canOpen ? (
          <Button variant="ghost" size="content"
            type="button"
            aria-label={uiT("Open {value0}", { value0: String(target) })}
            className={cn("-my-px flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 py-px leading-[1.2] text-left hover:text-accent justify-start", chip
                ? cn("max-w-full bg-content/6 hover:bg-content/10", targetTone)
                : cn("flex-1 hover:underline", targetTone))}
            title={target}
            onClick={(event) => {
              event.stopPropagation();
              openFile?.(filePath);
            }}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} size="1cap" />
            <span className="min-w-0 truncate">{target}</span>
          </Button>
        ) : (
          <span
            className={cn("flex min-w-0 items-center gap-1 rounded px-1 py-px leading-[1.2]", chip
                ? cn("max-w-full bg-content/6", targetTone)
                : cn("flex-1", targetTone))}
            title={target}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} size="1cap" />
            <span className="min-w-0 truncate">{target}</span>
          </span>
        )
      ) : (
        <span
          className={cn("flex min-w-0 flex-1 items-center gap-1.5 pl-1", targetTone)}
          title={target}
        >
          <span className="min-w-0 truncate">{target}</span>
        </span>
      )}
    </span>
  );
}

export function ApprovalControls({
  block,
  onApproval,
}: {
  block: Block;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const { t: uiT } = useTranslation();
  const approval = block.approval;
  if (!approval || approval.decided || !onApproval) return null;
  return (
    <div className="mt-1.5 flex flex-wrap justify-end gap-2" data-approval-controls>
      <Button variant="secondary"
        type="button"
        data-approval="deny"
        className="rounded-md bg-content/10 px-2.5 py-0.5 text-[11px] text-content/70 hover:bg-content/14"
        onClick={() => onApproval(approval.requestId, "deny")}
      >
        {uiT("Deny")}
      </Button>
      <Button variant="primary"
        type="button"
        data-approval="allow"
        className="rounded-md bg-content px-2.5 py-0.5 text-[11px] text-background-base hover:bg-content/80"
        onClick={() => onApproval(approval.requestId, "allow")}
      >
        {uiT("Allow")}
      </Button>
    </div>
  );
}
