import { ToolContentPanel } from "../ToolContentPanel";
import { cn } from "../../../../shared/lib/cn";
import { Button } from "../../../../shared/ui/forms/Button";
import { Omi } from "../../../../shared/ui/branding/Omi";
import { DisclosureChevron } from "../../../../shared/ui/DisclosureChevron";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useContext, useEffect, useState } from "react";
import { TranscriptPlatformContext } from "../TranscriptPlatform";
import { FilePreview } from "../../../connections/files/ui/FilePreview";
import { AnimatedCollapse } from "../../../../shared/ui/AnimatedCollapse";
import type { ApprovalDecision } from "../../../../integrations/harness";
import { isEditTool, stubFilePreview } from "../../../../integrations/harness/core/preview";
import { ToolRow } from "./tools/ToolRow";
import { ApprovalControls, ToolCallStatusIcon } from "./tools/ToolCallParts";
import { type Block } from "../../model/session";
import {
  isIncompleteTool,
  needsApproval,
  toolCallLabel,
  toolCallState,
} from "../../model/transcriptActivity";
import { omniCodeToolCall, type OmniCodeToolCall } from "../../model/omnicodeToolCall";



export function OmniCodeMark({ className = "size-4" }: { className?: string }) {
  return <Omi compact className={cn("shrink-0", className)} />;
}

/** OmniCode commands read like the other activity rows; failures expose their output. */
export function OmniCodeCallRow({
  block,
  call,
  onApproval,
}: {
  block: Block;
  call: OmniCodeToolCall;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const { t: uiT } = useTranslation();
  const state = toolCallState(block);
  const output =
    block.tool?.detail?.trim() || block.tool?.preview?.output?.trim();
  const [errorOpen, setErrorOpen] = useState(false);
  const { toolContentSelection } = useContext(TranscriptPlatformContext);
  useEffect(() => {
    if (block.toolContent && toolContentSelection?.blockId === block.toolContent.blockPath[0]) setErrorOpen(true);
  }, [block.toolContent?.blockPath[0], toolContentSelection]);
  const hasError = state === "rejected" && !!(output || block.toolContent);
  const hasDetails = hasError || !!block.toolContent;
  const pendingApproval = needsApproval(block);
  const command = `omnicode app ${call.action}`;
  const verb = pendingApproval
    ? "Run"
    : state === "pending"
      ? "Running"
      : "Ran";
  const summary = (
    <>
      <OmniCodeMark className="size-3.5" />
      <span
        className={cn("shrink-0 font-sans text-sm", state === "rejected" ? "text-danger" : "text-foreground-subtlest")}
      >
        {verb}
      </span>
      <span
        className={cn("flex min-w-0 max-w-full items-center gap-1 rounded bg-content/6 px-1 font-mono text-ui-caption", state === "rejected" ? "text-danger" : "text-content/70")}
        title={command}
      >
        <span className="min-w-0 truncate">{command}</span>
      </span>
      <ToolCallStatusIcon state={state} />
      {hasDetails ? (
        <DisclosureChevron expanded={errorOpen} className={cn("size-3.5 shrink-0", hasError ? "text-danger/60" : "text-content/60")} />
      ) : null}
    </>
  );
  return (
    <div data-omnicode-tool-call={call.action} className="min-w-0">
      {hasDetails ? (
        <Button data-session-disclosure variant="ghost" size="content"
          type="button"
          aria-expanded={errorOpen}
          aria-label={
            !hasError ? uiT(errorOpen ? "Hide details for {value0}" : "Show details for {value0}", { value0: call.label }) : errorOpen
              ? uiT("Hide error details for OmniCode: {value0}", {
                  value0: call.label,
                })
              : uiT("Show error details for OmniCode: {value0}", {
                  value0: call.label,
                })
          }
          onClick={() => setErrorOpen((value) => !value)}
          className="flex w-full min-w-0 items-center gap-1.5 py-1 text-left justify-start"
        >
          {summary}
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 py-1">{summary}</div>
      )}
      <AnimatedCollapse expanded={errorOpen && hasDetails}>
        {block.toolContent ? <ToolContentPanel reference={block.toolContent} active={errorOpen} /> :
          <pre className="zen-detail-panel whitespace-pre-wrap break-words text-danger/80">{output}</pre>}
      </AnimatedCollapse>
      {pendingApproval ? (
        <pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-all py-1 pl-5 font-mono text-ui-sm leading-5 text-content/70">
          {call.command}
        </pre>
      ) : null}
      <ApprovalControls block={block} onApproval={onApproval} />
    </div>
  );
}

export function ToolCall({
  block,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  embedded,
}: {
  block: Block;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  embedded?: boolean;
}) {
  const preview = block.tool?.preview;
  const label = toolCallLabel(block, cwd);
  const state = toolCallState(block);
  const frame = embedded ? "py-0.5" : "px-4 @md:px-6 py-1";

  const appCall = omniCodeToolCall(block);
  if (appCall) {
    return (
      <div className={frame}>
        <OmniCodeCallRow block={block} call={appCall} onApproval={onApproval} />
      </div>
    );
  }

  // An edit waiting on you shows the change itself, so you approve what it does.
  if (
    needsApproval(block) &&
    isEditTool(block.tool?.kind, block.text || block.tool?.title, preview)
  ) {
    return (
      <div className={frame}>
        <div data-approval-host>
          <FilePreview
            preview={preview ?? stubFilePreview(block.tool?.kind, label)}
            status={state}
            cwd={cwd}
            onOpenFile={onOpenDiff ?? onOpenFile}
          />
          <ApprovalControls block={block} onApproval={onApproval} />
        </div>
      </div>
    );
  }

  if (!block.toolContent && isIncompleteTool(block, label, state)) return null;

  return (
    <div className={frame}>
      <ToolRow
        block={block}
        cwd={cwd}
        variant="standalone"
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    </div>
  );
}
