// 「提升为全局」的发起编排。
//
// 项目档→全局档不是搬文件：项目工作流大多引用本仓库的路径 / 命令 / 约定，逐字节搬过去就是一个
// 在别的项目里必然跑坏的全局定义。这一步是模型的**概括**：GUI 在该项目建一个新会话，首条用户
// 消息就是概括提示（`createSession.firstInput`，自动发送），模型读文件、抽参数、经 SaveWorkflow
// （`scope: "global"`）另存一份；源文件不动，确认窗照走。
//
// 为什么不走「修订 / 通过对话创建」的 `onCreateViaChat`：那条路只预填 composer 草稿、不发送，
// 而这里用户点的是一个动作，不该再让他按一次发送。为什么不走直接启动器：它发的是
// startSavedWorkflow 命令（跑工作流），这里要发的是一条普通用户输入。带 firstInput 的 create
// 要么整体接受要么被拒，没有「会话建了、消息没发」的中间态，所以不需要回收逻辑。
import { useCallback, useRef, useState } from "react";
import { useWorkflowApp } from "../../../ui/workflowAppContext";
import type { WorkspaceConnectionAgentService } from "../../v4/workspaceConnectionRegistry.js";
import { buildSavedWorkflowPromotePrompt } from "./savedWorkflowLaunchPrompt.js";
import type { SavedWorkflowLaunchTarget } from "./useSavedWorkflowLauncher.js";

// Monocode: the promote prompt opens a new conversation in the project with the
// prompt in its composer, under /workflow so the authoring guide comes along.

/** 被提升的项目档：名字与路径进提示词（模型自己读文件），locale 选中英文案。 */
interface SavedWorkflowPromoteRequest {
  name: string;
  path: string;
  locale: string;
}

type SavedWorkflowPromoteResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      /** 原始 fault code / ACK 状态；日志与 toast 兜底文案用。 */
      code: string;
      /** 服务端人可读原因（有则优先展示）。 */
      message?: string;
    };

interface UseSavedWorkflowPromoteResult {
  promote: (
    target: SavedWorkflowLaunchTarget,
    request: SavedWorkflowPromoteRequest,
  ) => Promise<SavedWorkflowPromoteResult>;
  /** 正在发起：卡片 / 详情菜单禁用，防重复点击。 */
  pending: boolean;
}

/**
 * 载体 `agentService` = 该项目解析出的 agent service（项目组已经有它）；`onNavigate` 在 accepted
 * 后切到新会话（与直接启动共用 `onNavigateToLaunchedRun`）。运行时缺省模型 / 模式，不复用 composer
 * 草稿配置——与直接启动同一取舍。
 */
export function useSavedWorkflowPromote(params: {
  agentService: WorkspaceConnectionAgentService;
  onNavigate?: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
}): UseSavedWorkflowPromoteResult {
  const app = useWorkflowApp();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  void params;
  const promote = useCallback(
    async (target: SavedWorkflowLaunchTarget, request: SavedWorkflowPromoteRequest): Promise<SavedWorkflowPromoteResult> => {
      if (pendingRef.current) return { ok: false, code: "promote_in_flight" };
      if (!app) return { ok: false, code: "unavailable" };
      pendingRef.current = true;
      setPending(true);
      try {
        app.createViaChat(target.workspacePath, buildSavedWorkflowPromotePrompt(request), { send: true });
        return { ok: true, sessionId: "" };
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [app],
  );
  return { promote, pending };
}
