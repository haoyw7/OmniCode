// 中枢「运行」的直接启动编排。
// 不再合成对话文案：在目标项目里建一个空会话 → 向它发 startSavedWorkflow 命令 →
// accepted 则导航到新会话（启动卡已在顶部）；rejected / 抛错则删掉空会话、把错误回给调用方
// （实参窗行内 / toast），用户留在中枢。「失败在会话存在之前」（不变式 2）：createSession
// 被拒时不发 start、不留会话；start 被拒时立即 deleteSession 收回刚建的空会话。
import { useCallback, useRef, useState } from "react";
import { savedWorkflowStartRejectionReasonSchema, type SavedWorkflowStartRejectionReason } from "../../_shims/protocol.js";
import type { WorkspaceConnectionAgentService } from "../../v4/workspaceConnectionRegistry.js";
import { workflowRequest } from "../../../model/workflowClient";
import { logger } from "../../logger.js";

/** 目标项目坐标（工作流所属项目，绝不取活动项目；不变式 7）；remoteSessionId 决定连接 endpoint。 */
export interface SavedWorkflowLaunchTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

/** 启动请求：name 由解析结果保证（不变式 6），scope 定向查找，args 已由实参窗收齐。 */
interface SavedWorkflowLaunchRequest {
  name: string;
  scope: "project" | "global";
  args: Record<string, unknown>;
}

/** 错误原因 = 拒绝词表 ∪ 能力缺席 ∪ 兜底；直接映射 i18n key `workflows.hub.launch.error.<reason>`。 */
export type SavedWorkflowLaunchErrorReason =
  | SavedWorkflowStartRejectionReason
  | "unsupported"
  | "generic";

export interface SavedWorkflowLaunchError {
  reason: SavedWorkflowLaunchErrorReason;
  /** 原始 fault code / ACK 状态；仅用于日志与排障，不直接展示。 */
  code: string;
  /** 服务端人可读原因（编译诊断合并后已有界截断）；有则在行内 mono 块展示。 */
  message?: string;
}

type SavedWorkflowLaunchResult =
  | { ok: true; sessionId: string; runId: string; toolCallId: string }
  | { ok: false; error: SavedWorkflowLaunchError };

interface UseSavedWorkflowLauncherResult {
  launch: (
    target: SavedWorkflowLaunchTarget,
    request: SavedWorkflowLaunchRequest,
  ) => Promise<SavedWorkflowLaunchResult>;
  /** 正在启动：实参窗主按钮 loading + 禁用，防重复点击。 */
  pending: boolean;
  /** 最近一次启动失败（成功 / 新启动前清空）。 */
  error: SavedWorkflowLaunchError | null;
  clearError: () => void;
}

function launchError(reason: string, message: string): SavedWorkflowLaunchError {
  const parsed = savedWorkflowStartRejectionReasonSchema.safeParse(reason);
  return { reason: parsed.success ? parsed.data : "generic", code: reason, ...(message ? { message } : {}) };
}

export function useSavedWorkflowLauncher(params: {
  agentService: WorkspaceConnectionAgentService;
  onNavigate?: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
}): UseSavedWorkflowLauncherResult {
  const { onNavigate } = params;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SavedWorkflowLaunchError | null>(null);
  const pendingRef = useRef(false);
  const clearError = useCallback(() => setError(null), []);

  const launch = useCallback(
    async (target: SavedWorkflowLaunchTarget, request: SavedWorkflowLaunchRequest): Promise<SavedWorkflowLaunchResult> => {
      if (pendingRef.current) return { ok: false, error: { reason: "generic", code: "launch_in_flight" } };
      pendingRef.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await workflowRequest<
          | { ok: true; runId: string; sessionId: string }
          | { ok: false; reason: string; message: string; diagnostics?: string[] }
        >(target.workspacePath, "startInNewSession", {
          input: {
            name: request.name,
            saved: { name: request.name, scope: request.scope, ...(Object.keys(request.args).length > 0 ? { args: request.args } : {}) },
          },
        });
        if (result.ok) {
          onNavigate?.(target, result.sessionId);
          return { ok: true, sessionId: result.sessionId, runId: result.runId, toolCallId: `workflow-${result.runId}` };
        }
        const err = launchError(
          result.reason.startsWith("saved_") ? result.reason.slice("saved_".length) : result.reason === "diagnostics" ? "compile_failed" : result.reason,
          [result.message, ...(result.diagnostics ?? [])].join("\n"),
        );
        logger.warn("[saved-workflow-launch] start rejected", { reason: result.reason });
        setError(err);
        return { ok: false, error: err };
      } catch (thrown) {
        const err: SavedWorkflowLaunchError = { reason: "generic", code: "exception", message: thrown instanceof Error ? thrown.message : String(thrown) };
        setError(err);
        return { ok: false, error: err };
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [onNavigate],
  );

  return { launch, pending, error, clearError };
}
