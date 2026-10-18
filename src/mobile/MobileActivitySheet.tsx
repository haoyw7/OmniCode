import { useTranscriptHaptics } from "./useTranscriptHaptics";
import { MobileSpinner } from "./MobileSpinner";
import { TranscriptContentMotion, useMessageArrivals } from "../features/sessions/ui/TranscriptContentMotion";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileAgentSheet } from "./MobileAgentSheet";
import type { ComponentType } from "react";
import type { Block } from "../features/sessions/model/session";
import {
  isThinkingBlock,
  isToolBlock,
  proseSummary,
  toolCallLabel,
  toolCallState,
  toolCategory,
  workDiffStats,
  workSummaryLine,
  type ActivityWorkKind,
} from "../features/sessions/model/transcriptActivity";
import { useTranslation } from "../shared/i18n/useTranslation";
import {
  Bot,
  ChevronRight,
  CircleX,
  Eye,
  Pencil,
  Sparkles,
  StickyNote,
  Terminal,
  Wrench,
} from "../shared/ui/icons";
import { MobileSheet, MobileSheetHeader } from "./MobileSheet";
import { MobilePageTransition } from "./MobilePageTransition";
import { MobileToolSheet } from "./MobileToolSheet";

const WORK_ICONS: Record<ActivityWorkKind, ComponentType<{ size?: number }>> = {
  research: Eye,
  edit: Pencil,
  run: Terminal,
  agent: Bot,
  other: Wrench,
};

function StepIcon({ block }: { block: Block }) {
  if (isToolBlock(block)) {
    const Icon = WORK_ICONS[toolCategory(block)];
    return <Icon size={18} />;
  }
  return isThinkingBlock(block) ? (
    <Sparkles size={18} />
  ) : (
    <StickyNote size={18} />
  );
}

/** A group of steps on a rail; each tool call opens its own details. */
export function MobileActivitySheet({
  open = true,
  onExited,
  steps,
  cwd,
  live,
  onStep,
  onClose,
  selectedStep,
  selectedAgent,
  sessionBlocks,
  readBinaryFile,
  onBack,
  onOpenFile,
}: {
  open?: boolean;
  onExited?: () => void;
  steps: Block[];
  cwd?: string;
  live: boolean;
  onStep: (block: Block) => void;
  onClose: () => void;
  selectedStep?: Block;
  selectedAgent?: Block;
  sessionBlocks?: Block[];
  readBinaryFile?: (path: string) => Promise<Uint8Array>;
  onBack: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation();
  useTranscriptHaptics({ blocks: steps, busy: live, active: open && !selectedStep && !selectedAgent });
  const arrives = useMessageArrivals(steps, useSurfaceVisibility() && open && !selectedStep && !selectedAgent);
  return (
    <MobileSheet
      open={open}
      onExited={onExited}
      title={selectedAgent ? "Subagent conversation" : selectedStep ? "Tool details" : "Activity"}
      onClose={onClose}
      detents
    >
      <div className="mobile-sheet-pages">
        <MobilePageTransition
          slide
          visible={open}
          route={{
            key: selectedAgent ? `agent:${selectedAgent.id}` : selectedStep ? `tool:${selectedStep.id}` : "activity",
            section: "chat",
            depth: selectedAgent || selectedStep ? 1 : 0,
          }}
        >
          {selectedAgent ? (
            <MobileAgentSheet embedded key={selectedAgent.id} open={open} blocks={sessionBlocks ?? steps}
              blockId={selectedAgent.id} cwd={cwd} readBinaryFile={readBinaryFile} onBack={onBack} onClose={onClose} />
          ) : selectedStep ? (
            <MobileToolSheet
              embedded
              block={selectedStep}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onBack={onBack}
              onClose={onClose}
            />
          ) : (
            <>
              <MobileSheetHeader
                title={workSummaryLine(steps, live)}
                onClose={onClose}
              />
              <div className="mobile-sheet-page-scroll" data-mobile-page-scroll>
                <div className="mobile-activity-sheet">
                  <ol className="mobile-activity-steps">
                    {steps.map((block) => {
                      if (!isToolBlock(block)) {
                        const text = proseSummary(block.text);
                        if (!text) return null;
                        return (
                          <TranscriptContentMotion as="li"
                            key={block.id}
                            className="mobile-activity-step"
                            arrive={arrives(block.id)}
                          >
                            <div className="mobile-activity-note">
                              <span className="mobile-activity-icon">
                                <StepIcon block={block} />
                              </span>
                              <span className="mobile-activity-text">{text}</span>
                            </div>
                          </TranscriptContentMotion>
                        );
                      }
                      const state = toolCallState(block);
                      const diff = workDiffStats([block]);
                      return (
                        <TranscriptContentMotion as="li" key={block.id} className="mobile-activity-step" arrive={arrives(block.id)}>
                          <button type="button" onClick={() => onStep(block)}>
                            <span className="mobile-activity-icon">
                              <StepIcon block={block} />
                            </span>
                            <span className="mobile-activity-text mobile-detail-mono">
                              {toolCallLabel(block, cwd)}
                            </span>
                            {(diff.additions > 0 || diff.deletions > 0) && (
                              <span className="mobile-activity-diff">
                                <span data-kind="add">+{diff.additions}</span>
                                <span data-kind="del">−{diff.deletions}</span>
                              </span>
                            )}
                            {state === "pending" ? (
                              <MobileSpinner
                                size={16}
                                className="mobile-spin"
                                aria-label={t("Running")}
                              />
                            ) : state === "rejected" ? (
                              <CircleX
                                size={16}
                                className="mobile-activity-failed"
                                aria-label={t("Failed")}
                              />
                            ) : (
                              <ChevronRight size={16} aria-hidden="true" />
                            )}
                          </button>
                        </TranscriptContentMotion>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </>
          )}
        </MobilePageTransition>
      </div>
    </MobileSheet>
  );
}
