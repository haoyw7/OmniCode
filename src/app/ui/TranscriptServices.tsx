import { playCue } from "../../features/settings/model/sounds";
import { resolveHostNoteImage } from "../../features/notes/notesHost";
import { useMemo, type ReactNode } from "react";
import { desktopTranscriptServices } from "../../platform/tauri/transcriptServices";
import { TranscriptPlatformContext } from "../../shared/ui/markdown/TranscriptPlatform";
import { MarkdownRenderingContext } from "../../shared/ui/markdown/MarkdownRendering";
import { useMarkdownCodeRendering } from "../../features/settings/model/useMarkdownCodeRendering";
import { InboxMedia } from "../../features/inbox/ui/InboxMedia";
import { INBOX_MEDIA_PREFIXES, isInboxMediaUrl } from "../../features/inbox/model/inboxMedia";
import { BotWorkerTranscriptContext, type BotWorkerTranscriptProps } from "../../features/bots/ui/BotWorkerPresentation";
import { AgentTranscript } from "../../features/sessions/ui/AgentTranscript";

const platform = { ...desktopTranscriptServices, resolveNoteImage: resolveHostNoteImage, onCopy: () => playCue("copy") };

const inboxMedia = {
  allowedPrefixes: INBOX_MEDIA_PREFIXES,
  accepts: isInboxMediaUrl,
  render: (src: string, alt?: string) => <InboxMedia src={src} alt={alt} />,
};

function WorkerTranscript({ snapshot, visible }: BotWorkerTranscriptProps) {
  const { session } = snapshot;
  return <AgentTranscript blocks={session.blocks} busy={snapshot.status === "running"}
    cwd={session.cwd} harness={session.harness} model={session.model}
    modelSettings={session.modelSettings} executionState={session.executionState}
    managed visible={visible} />;
}

export function TranscriptServices({ children }: { children: ReactNode }) {
  const code = useMarkdownCodeRendering();
  const rendering = useMemo(() => ({ ...code, media: inboxMedia }), [code]);
  return (
    <TranscriptPlatformContext.Provider value={platform}>
      <MarkdownRenderingContext.Provider value={rendering}>
        <BotWorkerTranscriptContext.Provider value={WorkerTranscript}>
          {children}
        </BotWorkerTranscriptContext.Provider>
      </MarkdownRenderingContext.Provider>
    </TranscriptPlatformContext.Provider>
  );
}
