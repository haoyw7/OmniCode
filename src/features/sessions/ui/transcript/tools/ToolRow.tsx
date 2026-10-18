import { DisclosureChevron } from "../../../../../shared/ui/DisclosureChevron";
import { useContext, useState } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import type { ApprovalDecision } from "../../../../../integrations/harness";
import type { Block } from "../../../model/session";
import {
  needsApproval,
  toolCallLabel,
  toolCallState,
} from "../../../model/transcriptActivity";
import {
  resolveToolRenderer,
  toolBodyText,
} from "../../../model/toolRenderer";
import { TranscriptPlatformContext } from "../../TranscriptPlatform";
import { ToolOutput } from "./ToolBody";
import {
  ApprovalControls,
  ToolKindIcon,
  ToolCallStatusIcon,
  ToolCallSummary,
  ToolOpenRow,
} from "./ToolCallParts";

/**
 * One tool call: a summary line every renderer shares, and whatever the call
 * opens onto under it — a command's output, a skill's or MCP call's result.
 * `activity` rows sit on a phase rail; `standalone` rows stand in the
 * transcript on their own.
 */
export function ToolRow({
  block,
  cwd,
  live = false,
  variant,
  compact = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  variant: "activity" | "standalone";
  /** Keep file targets in compact chips within an activity trail. */
  compact?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { openTool } = useContext(TranscriptPlatformContext);
  const [override, setOverride] = useState<boolean | null>(null);
  const renderer = resolveToolRenderer(block);
  const label = toolCallLabel(block, cwd);
  const state = toolCallState(block);
  const pending = needsApproval(block);
  const failed = state === "rejected";
  const running = state === "pending";
  const activity = variant === "activity";
  // The question card beside the trail shows what was asked and answered.
  const bodyText =
    renderer === "question" ? undefined : toolBodyText(block, renderer);
  // Shell previews retain the full command even when the summary is shortened.
  // Let readers inspect it before the process has printed any output.
  const command = renderer === "execute" && running
    ? (block.tool?.preview?.kind === "shell" ? block.tool.preview.title : undefined)
      || block.tool?.input || block.tool?.title || block.text
    : undefined;
  const expandable = !pending && !!(command || bodyText);
  // A command you are watching run shows its output; it folds once it is done.
  const autoOpen = renderer === "execute" && live && running && !!bodyText;
  const open = expandable && (override ?? autoOpen);
  const toggle = () => setOverride(!open);

  const icon = (
    <ToolKindIcon renderer={renderer} state={state} live={live} />
  );
  const statusIcon =
    !pending ? <ToolCallStatusIcon state={state} /> : null;
  const summary =
    renderer === "question" ? (
      <span
        className={`min-w-0 flex-1 truncate font-sans text-sm ${
          failed ? "text-red-400" : "text-foreground-subtlest"
        }`}
      >
        {t("Asked a question")}
      </span>
    ) : (
      <ToolCallSummary
        label={label}
        preview={block.tool?.preview}
        cwd={cwd}
        chip={activity && compact}
        failed={failed}
        status={state}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  const gap = activity ? "gap-1.5" : "gap-2";

  if (openTool && !pending) {
    return (
      <ToolOpenRow
        block={block}
        label={label}
        className={`flex w-full min-w-0 items-center ${gap} py-1`}
        onOpen={openTool}
      >
        {icon}
        {summary}
        {statusIcon}
      </ToolOpenRow>
    );
  }

  return (
    <div data-tool-renderer={renderer} className="flex min-w-0 flex-col">
      <div
        aria-label={
          failed
            ? t("Failed tool call: {value0}", { value0: label })
            : t("Tool call: {value0}", { value0: label })
        }
        className={`group flex min-w-0 items-center ${gap} py-1`}
      >
        {icon}
        {expandable ? (
          <div className="flex min-w-0 flex-1 cursor-pointer" onClick={toggle}>
            {summary}
          </div>
        ) : (
          summary
        )}
        {statusIcon}
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={
              failed
                ? open
                  ? t("Hide error details for {value0}", { value0: label })
                  : t("Show error details for {value0}", { value0: label })
                : open
                  ? t("Hide details for {value0}", { value0: label })
                  : t("Show details for {value0}", { value0: label })
            }
            onClick={toggle}
            className="-m-1 shrink-0 rounded p-1"
          >
            <DisclosureChevron
              expanded={open}
              className={`zen-disclosure-chevron size-3.5 ${
                failed ? "text-red-400/60" : ""
              } ${open ? "opacity-100" : ""}`}
            />
          </button>
        ) : null}
      </div>
      {pending ? (
        <ApprovalControls block={block} onApproval={onApproval} />
      ) : null}
      {expandable ? (
        <AnimatedCollapse expanded={open}>
          {() => (
            <>
              {command ? (
                <pre data-tool-command="" className="zen-detail-panel max-h-60 overflow-auto whitespace-pre-wrap break-words">
                  {command}
                </pre>
              ) : null}
              {bodyText ? (
                <ToolOutput
                  text={bodyText}
                  live={live && running}
                  failed={failed}
                />
              ) : null}
            </>
          )}
        </AnimatedCollapse>
      ) : null}
    </div>
  );
}
