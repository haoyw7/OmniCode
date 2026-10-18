import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../features/sessions/model/session";
import {
  agentTranscript,
  resolveAgentBlock,
} from "../features/sessions/model/agentTranscript";
import {
  subagentModelName,
  subagentName,
  subagentReport,
  toolCallState,
} from "../features/sessions/model/transcriptActivity";
import { TranscriptPlatformContext } from "../features/sessions/ui/TranscriptPlatform";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileSheet, MobileSheetHeader } from "./MobileSheet";
import { MobilePageTransition } from "./MobilePageTransition";
import { MobilePageStateContext } from "./mobilePageState";
import { MobileToolSheet } from "./MobileToolSheet";
import { MobileFileSheet } from "./MobileFileSheet";
import { MobileConversation } from "./MobileConversation";
import { mobileTranscriptPlatform } from "./transcriptPlatform";

type Page =
  { kind: "agent" | "tool"; path: string[] } | { kind: "file"; file: string };

function Conversation({
  block,
  cwd,
  readBinaryFile,
  openAgent,
  openTool,
  openFile,
}: {
  block: Block;
  cwd?: string;
  readBinaryFile?: (path: string) => Promise<Uint8Array>;
  openAgent: (block: Block) => void;
  openTool: (block: Block) => void;
  openFile?: (path: string) => void;
}) {
  const pageState = useContext(MobilePageStateContext);
  const parentPlatform = useContext(TranscriptPlatformContext);
  const visible = useSurfaceVisibility();
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const transcript = agentTranscript(block);
    const report = subagentReport(block);
    return report && !transcript.some((row) => row.role === "assistant" && row.text.trim() === report)
      ? [...transcript, { id: `${block.id}:report`, role: "assistant" as const, text: report }]
      : transcript;
  }, [block]);
  const platform = useMemo(() => ({
    ...mobileTranscriptPlatform,
    readBinaryFile: readBinaryFile ?? mobileTranscriptPlatform.readBinaryFile,
    resolveNoteImage: parentPlatform.resolveNoteImage,
    openAgent,
    openTool,
    liveClockInFooter: true,
  }), [readBinaryFile, parentPlatform.resolveNoteImage, openAgent, openTool]);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const restored = useRef(false);
  const restoreScroller = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.dataset.mobilePageScroll = "";
    setScroller(node);
  }, []);
  // Restore after the shared transcript has established its initial bottom pin.
  // Page transitions save this same scroller before releasing a departing page.
  useLayoutEffect(() => {
    if (!scroller || !visible || restored.current) return;
    restored.current = true;
    const saved = pageState?.scroll.get("[data-mobile-page-scroll]");
    if (saved !== undefined) {
      scroller.scrollTop = saved;
      // Reconcile following before another streamed layout can pin the reader.
      scroller.dispatchEvent(new Event("scroll"));
    }
  }, [scroller, visible, pageState]);
  const legacy = block.agentRun?.transcript === undefined;
  const incomplete = block.agentRun?.coverage === "partial" || (legacy && rows.length > 0);
  const busy = toolCallState(block) === "pending";
  return (
    <TranscriptPlatformContext.Provider value={platform}>
      <MobileConversation
        embedded
        managed
        active={visible}
        hapticsScope={block.id}
        hapticsCompleted={toolCallState(block) !== "rejected"}
        visible={visible}
        blocks={rows}
        busy={busy}
        cwd={cwd}
        onOpenFile={openFile}
        onOpenDiff={openFile}
        onScrollerChange={restoreScroller}
        notice={incomplete || !rows.length ? (
          <p className="mobile-detail-note" role={incomplete ? "note" : "status"}>
            {t(incomplete
              ? legacy
                ? "Historical subagent records may be incomplete."
                : "The provider supplied only part of this subagent's conversation."
              : busy
                ? "Waiting for subagent messages…"
                : "The provider did not supply this subagent's conversation.")}
          </p>
        ) : undefined}
      />
    </TranscriptPlatformContext.Provider>
  );
}

export function MobileAgentSheet({
  open,
  onExited,
  blocks,
  blockId,
  cwd,
  readBinaryFile,
  onBack,
  onClose,
  embedded = false,
}: {
  open: boolean;
  onExited?: () => void;
  embedded?: boolean;
  blocks: Block[];
  blockId: string;
  cwd?: string;
  readBinaryFile?: (path: string) => Promise<Uint8Array>;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<Page[]>([
    { kind: "agent", path: [blockId] },
  ]);
  const { t } = useTranslation();
  const page = pages[pages.length - 1];
  const block =
    page.kind === "file" ? undefined : resolveAgentBlock(blocks, page.path);
  const back =
    pages.length > 1 ? () => setPages((value) => value.slice(0, -1)) : onBack;
  const pushFile = readBinaryFile
    ? (file: string) => setPages((value) => [...value, { kind: "file", file }])
    : undefined;
  const pushBlock = (kind: "agent" | "tool", next: Block) => {
    if (page.kind === "file") return;
    setPages((value) => [...value, { kind, path: [...page.path, next.id] }]);
  };
  const key =
    page.kind === "file"
      ? `file:${page.file}`
      : `${page.kind}:${page.path.join("/")}`;
  const content = (
    <div className="mobile-sheet-pages">
      <MobilePageTransition
        slide
        visible={open}
        route={{ key, section: "chat", depth: pages.length }}
      >
        {page.kind === "file" && readBinaryFile ? (
          <MobileFileSheet
            embedded
            path={page.file}
            cwd={cwd}
            readBinaryFile={readBinaryFile}
            onOpenFile={pushFile}
            onBack={back}
            onClose={onClose}
          />
        ) : block && page.kind === "tool" ? (
          <MobileToolSheet
            embedded
            block={block}
            cwd={cwd}
            onBack={back}
            onClose={onClose}
            onOpenFile={pushFile}
          />
        ) : block ? (
          <>
            <MobileSheetHeader
              title={subagentName(block)}
              subtitle={[
                subagentModelName(block),
                t(
                  toolCallState(block) === "pending"
                    ? "Running"
                    : toolCallState(block) === "rejected"
                      ? "Failed"
                      : "Completed",
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
              onBack={back}
              onClose={onClose}
            />
            <Conversation
              block={block}
              cwd={cwd}
              readBinaryFile={readBinaryFile}
              openAgent={(row) => pushBlock("agent", row)}
              openTool={(row) => pushBlock("tool", row)}
              openFile={pushFile}
            />
          </>
        ) : (
          <>
            <MobileSheetHeader
              title={t("Subagent conversation")}
              onBack={back}
              onClose={onClose}
            />
            <p className="mobile-detail-note">
              {t("This subagent record is no longer available.")}
            </p>
          </>
        )}
      </MobilePageTransition>
    </div>
  );
  return embedded ? (
    content
  ) : (
    <MobileSheet
      open={open}
      onExited={onExited}
      title="Subagent conversation"
      onClose={onClose}
      detents
    >
      {content}
    </MobileSheet>
  );
}
