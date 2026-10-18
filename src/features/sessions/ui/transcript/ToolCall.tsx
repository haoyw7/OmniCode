import { Omi } from "../../../../shared/ui/branding/Omi";
import { DisclosureChevron } from "../../../../shared/ui/DisclosureChevron";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useState } from "react";
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
  return <Omi compact className={`shrink-0 ${className}`} />;
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
  const hasError = state === "rejected" && !!output;
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
        className={`shrink-0 font-sans text-sm ${state === "rejected" ? "text-red-400" : "text-foreground-subtlest"}`}
      >
        {verb}
      </span>
      <span
        className={`flex min-w-0 max-w-full items-center gap-1 rounded bg-content/6 px-1 font-mono text-ui-caption ${state === "rejected" ? "text-red-400" : "text-content/70"}`}
        title={command}
      >
        <span className="min-w-0 truncate">{command}</span>
      </span>
      <ToolCallStatusIcon state={state} />
      {hasError ? (
        <DisclosureChevron expanded={errorOpen} className="size-3.5 shrink-0 text-red-400/60" />
      ) : null}
    </>
  );
  return (
    <div data-omnicode-tool-call={call.action} className="min-w-0">
      {hasError ? (
        <button
          type="button"
          aria-expanded={errorOpen}
          aria-label={
            errorOpen
              ? uiT("Hide error details for OmniCode: {value0}", {
                  value0: call.label,
                })
              : uiT("Show error details for OmniCode: {value0}", {
                  value0: call.label,
                })
          }
          onClick={() => setErrorOpen((value) => !value)}
          className="flex w-full min-w-0 items-center gap-1.5 py-1 text-left"
        >
          {summary}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 py-1">{summary}</div>
      )}
      <AnimatedCollapse expanded={errorOpen && hasError}>
        <pre className="zen-detail-panel whitespace-pre-wrap break-words text-red-400/80">
          {output}
        </pre>
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

  if (isIncompleteTool(block, label, state)) return null;

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
