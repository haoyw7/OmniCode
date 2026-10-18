import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { localizeChildExitError } from "../../../../integrations/harness/core/childErrors";
import {
  providerSessionAccessIssue,
} from "../../../../integrations/harness/providers/sessionAccessErrors";
import { SessionAccessNotice } from "../SessionAccessNotice";
import { QuestionHistoryCard } from "../QuestionHistoryCard";
import type { QuestionAnswer } from "../../model/userQuestion";
import { memo, useContext } from "react";
import { GeneratedImage } from "../GeneratedImage";
import { PlanPreview } from "../PlanPreview";
import { localizeOrchestrationMessage } from "../../../orchestration/ui/orchestrationMessages";
import { TaskListPreview } from "../TaskListPreview";
import type { ApprovalDecision } from "../../../../integrations/harness";
import { TranscriptPlatformContext } from "../TranscriptPlatform";
import { legacyTaskListFromText } from "../../model/taskList";
import { type Block, type HarnessId, type PlanBuildTarget } from "../../model/session";
import type { TranscriptLayout } from "../../../settings/model/appearance";
import { AgentMarkdown } from "../AgentMarkdown";
import { UserMessageBlock } from "./UserMessageBlock";
import { ToolCall } from "./ToolCall";
import { HandoffDivider, InterjectionDivider } from "./Dividers";



export const TranscriptBlock = memo(function TranscriptBlock({
  block,
  questionPending = false,
  onQuestionFollowUp,
  harness,
  layout,
  visible,
  stickyIndex,
  underLine = false,
  embedded = false,
  cwd,
  onApproval,
  onSaveNote,
  onSendDraft,
  onRemoveDraft,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  planDecision = false,
  planBusy,
  planHarness,
  planModel,
  planModelSettings,
  onEditLastTurn,
  editing = false,
}: {
  block: Block;
  questionPending?: boolean;
  onQuestionFollowUp?: (answer: QuestionAnswer) => boolean | void | Promise<boolean | void>;
  harness?: HarnessId;
  layout: TranscriptLayout;
  visible?: boolean;
  stickyIndex: number;
  /** True when something already sits directly above this in the turn. */
  underLine?: boolean;
  /** True when the parent surface already provides the horizontal gutter. */
  embedded?: boolean;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onBuildPlan?: (blockId: string, target?: PlanBuildTarget) => void;
  planDecision?: boolean;
  planBusy?: boolean;
  planHarness?: HarnessId;
  planModel?: string;
  planModelSettings?: Record<string, string>;
  onEditLastTurn?: () => void;
  editing?: boolean;
}) {
  const { textReveal, openPlan } = useContext(TranscriptPlatformContext);
  const { t: uiT } = useTranslation();
  // Workflow run cards render after the turn's work, like orchestration results.
  if (block.workflowRun) return null;
  if (block.question) {
    return <QuestionHistoryCard blockId={block.id} question={block.question}
      pending={questionPending} onAnswer={onQuestionFollowUp} />;
  }
  if (block.role === "user") {
    return (
      <UserMessageBlock
        block={block}
        layout={layout}
        visible={visible ?? true}
        stickyIndex={stickyIndex}
        cwd={cwd}
        onEdit={onEditLastTurn}
        editing={editing}
        onSaveNote={onSaveNote}
        onSendDraft={onSendDraft}
        onRemoveDraft={onRemoveDraft}
        onOpenFile={onOpenFile}
      />
    );
  }

  if (block.role === "image") {
    return block.image ? (
      <GeneratedImage
        image={block.image}
        attachment={block.attachments?.find((file) => file.kind === "image")}
      />
    ) : null;
  }

  if (block.role === "tool") {
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        embedded={embedded}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "reasoning") {
    return null;
  }

  if (block.role === "tasks") {
    if (!block.taskList?.items.length) return null;
    return (
      <div className={embedded ? "py-1" : "px-4 @md:px-6 py-1"}>
        <TaskListPreview
          items={block.taskList.items}
          explanation={block.taskList.explanation}
        />
      </div>
    );
  }

  if (block.role === "plan") {
    if (block.orchestration) return null;
    const legacyTasks = legacyTaskListFromText(block.text);
    if (legacyTasks) {
      return (
        <div className={embedded ? "py-1" : "px-4 @md:px-6 py-1"}>
          <TaskListPreview items={legacyTasks} />
        </div>
      );
    }
    return (
      <div className={embedded ? "py-1" : "px-4 @md:px-6 py-1"}>
        <PlanPreview
          text={block.text}
          streaming={block.streaming}
          busy={planBusy}
          plan={block.plan}
          harness={planHarness}
          model={planModel}
          modelSettings={planModelSettings}
          cwd={cwd}
          deciding={planDecision}
          paneButton={!openPlan}
          onOpen={
            openPlan
              ? () => openPlan(block.id)
              : onOpenPlan
                ? () => onOpenPlan(block.id)
                : undefined
          }
          onBuild={
            onBuildPlan ? (target) => onBuildPlan(block.id, target) : undefined
          }
        />
      </div>
    );
  }

  if (block.role === "approval") {
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        embedded={embedded}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "handoff") {
    return <HandoffDivider block={block} />;
  }

  if (block.role === "system") {
    if (block.interjection) {
      return <InterjectionDivider block={block} />;
    }
    const issue =
      harness && block.notice === "error"
        ? providerSessionAccessIssue(harness, block.text)
        : undefined;
    if (harness && issue) {
      return (
        <div className={`${embedded ? "" : "px-4 @md:px-6"} py-2`}>
          <SessionAccessNotice
            harness={harness}
            issue={issue}
            message={block.text}
          />
        </div>
      );
    }
    return (
      <div className={`${embedded ? "" : "px-4 @md:px-6"} py-2 text-content/50`}>
        <pre className="min-w-0 whitespace-pre-wrap break-words">
          {localizeOrchestrationMessage(localizeChildExitError(block.text, uiT), uiT)}
        </pre>
      </div>
    );
  }

  if (!block.text && block.streaming && !textReveal) return null;

  return (
    <div
      data-selectable-agent-response={block.streaming ? undefined : block.id}
      data-assistant-message
      className={`min-w-0 pb-1 text-content ${embedded ? "" : "px-4 @md:px-6"} ${underLine ? "pt-1" : "pt-3"}`}
    >
      <AgentMarkdown
        text={block.text}
        streamingKey={block.id}
        streaming={block.streaming}
        cwd={cwd}
        onOpenFile={onOpenFile}
      />
    </div>
  );
});
