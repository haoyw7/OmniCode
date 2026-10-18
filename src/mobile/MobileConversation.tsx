import { motion } from "motion/react";
import { popTransition, immediateTransition } from "../shared/motion/tokens";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { useTranscriptHaptics } from "./useTranscriptHaptics";
import {
  useCallback,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { AgentTranscript } from "../features/sessions/ui/AgentTranscript";
import { useTranscriptLayout } from "../features/sessions/hooks/useTranscriptLayout";
import { useTranslation } from "../shared/i18n/useTranslation";
import { ArrowDownCircle } from "../shared/ui/icons";
import { useCollapseMotion } from "../shared/ui/AnimatedCollapse";

/** The phone conversation surface, shared by chats and subagent sheet pages. */
export function MobileConversation({
  active = true,
  containerRef,
  progress = false,
  embedded = false,
  notice,
  hapticsActive = active,
  hapticsScope,
  hapticsAttention,
  hapticsCompleted = true,
  ...transcript
}: Omit<
  ComponentProps<typeof AgentTranscript>,
  "onJumpToBottomChange" | "onJumpToBottomReady"
> & {
  active?: boolean;
  hapticsActive?: boolean;
  hapticsScope?: string;
  hapticsAttention?: string;
  hapticsCompleted?: boolean;
  containerRef?: Ref<HTMLDivElement>;
  progress?: boolean;
  embedded?: boolean;
  notice?: ReactNode;
}) {
  useTranscriptHaptics({
    blocks: transcript.blocks, busy: !!transcript.busy,
    active: hapticsActive && transcript.visible !== false,
    scope: hapticsScope, history: transcript.historyEntries,
    attention: hapticsAttention, completed: hapticsCompleted,
  });
  const { t } = useTranslation();
  const layout = useTranscriptLayout();
  const [jump, setJump] = useState<(() => void) | undefined>();
  const [showJump, setShowJump] = useState(false);
  const jumpMotion = useCollapseMotion(showJump);
  const reduced = useMotionPreference();
  const onJumpReady = useCallback(
    (callback: () => void) => setJump(() => callback),
    [],
  );
  return (
    <div
      ref={containerRef}
      className="mobile-desktop-transcript"
      data-layout={layout}
      data-progress={progress}
      data-embedded={embedded || undefined}
      role="log"
      aria-label={t("Conversation")}
      aria-live={active ? "polite" : "off"}
      aria-hidden={!active || undefined}
      inert={!active}
    >
      {notice}
      <AgentTranscript
        touchScroll
        promptMotion="mobile"
        {...transcript}
        onJumpToBottomChange={setShowJump}
        onJumpToBottomReady={onJumpReady}
      />
      {/* Keep the button mounted so fades can reverse without restarting. */}
      <motion.button
        initial={false}
        animate={{ opacity: showJump ? 1 : 0 }}
        transition={reduced ? immediateTransition : popTransition}
        onAnimationComplete={jumpMotion.finish}
        className="mobile-jump"
        type="button"
        data-open={showJump}
        data-fold-state={jumpMotion.foldState}
        disabled={!showJump}
        inert={!showJump}
        aria-hidden={!showJump}
        aria-label={t("Jump to latest")}
        // Keep focus in the composer so tapping does not collapse it first.
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          jump?.();
        }}
      >
        <ArrowDownCircle size={22} />
      </motion.button>
    </div>
  );
}
