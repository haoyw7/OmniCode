import { useCallback, useMemo } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import type { FilePaneTab, SubagentTabSource } from "../../workspace/model/layout";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";
import { agentTranscript, resolveAgentBlock } from "../../../domain/agentTranscript";
import { sessionExecutionCwd } from "../../../domain/session";
import { type Session } from "../../../contracts/session";
import { subagentModelName, subagentReport, toolCallState } from "../model/transcriptActivity";
import { AgentTranscript } from "./AgentTranscript";
import { HarnessIcon } from "../../../shared/ui/HarnessIcon";
import { useOpenSubagent } from "./SubagentTabsContext";

export function SubagentTabView({
  file,
  session,
  visible,
  onOpenFile,
}: {
  file: FilePaneTab & { subagent: SubagentTabSource };
  session?: Session;
  visible: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const block = resolveAgentBlock(session?.blocks ?? [], file.subagent.path);
  const openAgent = useOpenSubagent(session, file.subagent.path, file.id);
  const cwd = session ? sessionExecutionCwd(session) : file.cwd;
  const openFile = useCallback(
    (path: string) => {
      const remote = parseRemotePath(cwd);
      if (!remote || parseRemotePath(path)) return onOpenFile?.(path);
      const absolute = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
        ? path
        : `${remote.hostPath}/${path}`;
      onOpenFile?.(remotePath(remote.environmentId, absolute));
    },
    [cwd, onOpenFile],
  );
  const rows = useMemo(() => {
    if (!block) return [];
    const transcript = agentTranscript(block);
    const report = subagentReport(block);
    return report &&
      !transcript.some(
        (row) => row.role === "assistant" && row.text.trim() === report,
      )
      ? [
          ...transcript,
          {
            id: `${block.id}:report`,
            role: "assistant" as const,
            text: report,
          },
        ]
      : transcript;
  }, [block]);
  if (!block)
    return (
      <p className="p-4 text-sm text-content/50" role="status">
        {t("This subagent record is no longer available.")}
      </p>
    );
  const state = toolCallState(block);
  const busy = state === "pending";
  const legacy = block.agentRun?.transcript === undefined;
  const incomplete =
    block.agentRun?.coverage === "partial" || (legacy && rows.length > 0);
  const model = subagentModelName(block);
  return (
    <div data-subagent-tab className="flex h-full min-h-0 flex-col">
      {incomplete || !rows.length ? (
        <p
          className="px-4 py-2 text-sm text-content/50"
          role={incomplete ? "note" : "status"}
        >
          {t(
            incomplete
              ? legacy
                ? "Historical subagent records may be incomplete."
                : "The provider supplied only part of this subagent's conversation."
              : busy
                ? "Waiting for subagent messages…"
                : "The provider did not supply this subagent's conversation.",
          )}
        </p>
      ) : null}
      <div className="@container relative min-h-0 flex-1">
        <AgentTranscript
          blocks={rows}
          busy={busy}
          visible={visible}
          cwd={cwd}
          harness={file.subagent.harness}
          model={block.agentRun?.model ?? session?.model}
          managed
          onOpenAgent={openAgent}
          onOpenFile={openFile}
          onOpenDiff={openFile}
        />
      </div>
      <footer className="flex shrink-0 items-center gap-1.5 border-t border-stroke px-3 py-1.5 text-[11px] text-content/45">
        <HarnessIcon
          harness={file.subagent.harness}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 truncate">
          {[
            model,
            t(busy ? "Running" : state === "rejected" ? "Failed" : "Completed"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="ml-auto shrink-0">{t("Subagent · read-only")}</span>
      </footer>
    </div>
  );
}
