import type { ReactNode } from "react";
import { MarkdownRenderingContext } from "../shared/ui/markdown/MarkdownRendering";
import { TranscriptPlatformContext } from "../shared/ui/markdown/TranscriptPlatform";
import { useMarkdownCodeRendering } from "../features/settings/model/useMarkdownCodeRendering";
import { mobileTranscriptPlatform } from "./transcriptPlatform";
import { BotWorkerTranscriptContext, type BotWorkerTranscriptProps } from "../features/bots/ui/BotWorkerPresentation";
import { AgentTranscript } from "../features/sessions/ui/AgentTranscript";
import { TranscriptCardsContext, type TranscriptCards } from "../features/sessions/model/sessionPresentation";
import { OrchestrationPreview } from "../features/orchestration/ui/OrchestrationPreview";
import { WorkflowRunCard } from "../features/workflows/ui/WorkflowRunCard";
import { NoteMiniCard } from "../features/notes/ui/NoteMiniCard";

const cards: TranscriptCards = { OrchestrationPreview, WorkflowRunCard, NoteMiniCard };

function WorkerTranscript({ snapshot, visible }: BotWorkerTranscriptProps) {
  const { session } = snapshot;
  return <AgentTranscript blocks={session.blocks} busy={snapshot.status === "running"}
    cwd={session.cwd} harness={session.harness} model={session.model}
    modelSettings={session.modelSettings} executionState={session.executionState}
    managed visible={visible} />;
}

export function MarkdownServices({ children }: { children: ReactNode }) {
  const rendering = useMarkdownCodeRendering();
  return (
    <TranscriptPlatformContext.Provider value={mobileTranscriptPlatform}>
      <MarkdownRenderingContext.Provider value={rendering}>
        <BotWorkerTranscriptContext.Provider value={WorkerTranscript}>
          <TranscriptCardsContext.Provider value={cards}>{children}</TranscriptCardsContext.Provider>
        </BotWorkerTranscriptContext.Provider>
      </MarkdownRenderingContext.Provider>
    </TranscriptPlatformContext.Provider>
  );
}
