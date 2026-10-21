import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../../shared/lib/queryClient";
import { translate } from "../../../../shared/i18n/language";
import { workflowQueryScope } from "../../model/workflowQueryKeys";
import { PROTOCOL_V4_LIMITS } from "../_shims/protocol.js";
import { logger } from "../logger.js";
import { useV4Conversation } from "../v4/V4ConversationContext.js";

/**
 * 内容产物（`file` / `markdown`）的字节读取。
 *
 * 逐字照 `attachmentRead` 的分块习语：一块 ≤ 512 KiB，`nextOffset` 为 null 即读完。
 * 全量拼进内存的上界是 `ARTIFACT_CAPS.maxFileBytes`（= 20 MiB，与附件同级），
 * 这个量级下一次性 Blob 比让每个查看器各自去做 range 读简单得多——查看器全是既有的叶子组件，
 * 它们要的是 Blob / ArrayBuffer，不是一个游标。
 *
 * ```
 * offset 0 ──read──▶ {dataBase64, mediaType, totalBytes, nextOffset}
 *        ◀──────────  解码成 Uint8Array 塞进 chunks[]
 *   nextOffset ──read──▶ …  直到 null
 *        ▼
 *   拼成一个 Uint8Array ─▶ Blob ─▶ objectUrl（卸载 / 换版本时 revoke）
 * ```
 */

/** 一块的字节数。与附件用同一个常量，不另铸——网关那边的上界就是它。 */
const CHUNK_BYTES = PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes;

/**
 * 一份产物最多读多少块。20 MiB / 512 KiB = 40 块，留一倍余量当死循环刹车：
 * 一个不肯把 `nextOffset` 收敛到 null 的实现不该把渲染线程锁死。
 */
const MAX_CHUNKS = 96;

interface WorkflowRunArtifactBytesState {
  bytes: Uint8Array<ArrayBuffer> | null;
  blob: Blob | null;
  /** Blob 的 object URL；`<img src>` / PdfViewer 用。卸载与换版本时自动 revoke。 */
  objectUrl: string | null;
  /** journal 记录上的 contentType（不是 store 重新嗅探出来的那个）——渲染器分派的精确匹配契约。 */
  mediaType: string | null;
  totalBytes: number | null;
  /** Absolute path on the owning Host; absent with older Hosts. */
  storedPath: string | null;
  loading: boolean;
  error: string | null;
}

function emptyState(): WorkflowRunArtifactBytesState {
  return {
    bytes: null,
    blob: null,
    objectUrl: null,
    mediaType: null,
    totalBytes: null,
    storedPath: null,
    loading: false,
    error: null,
  };
}

/** base64 → 字节。renderer 里 `atob` 恒在（Electron 与浏览器都是 Chromium）。 */
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function useWorkflowRunArtifactBytes(options: {
  sessionId: string;
  runId: string;
  artifactId: string;
  version: number;
  /** 关掉即不读，也不留下任何 object URL（预置看板与折叠态都靠它省掉整条链路）。 */
  enabled?: boolean;
}): WorkflowRunArtifactBytesState {
  const { workflowRunArtifactRead } = useV4Conversation();
  const [preview, setPreview] = useState<{ blob: Blob; url: string | null }>();

  const { artifactId, runId, sessionId, version } = options;
  const enabled =
    options.enabled !== false &&
    sessionId.length > 0 &&
    runId.length > 0 &&
    artifactId.length > 0 &&
    version > 0;

  const queryKey = [...workflowQueryScope(workflowRunArtifactRead), "bytes", sessionId, runId, artifactId, version] as const;
  const query = useQuery({
    queryKey,
    enabled,
    gcTime: 0,
    staleTime: Infinity,
    structuralSharing: false,
    queryFn: async ({ signal }) => {
      try {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let offset = 0;
        let mediaType = "application/octet-stream";
        let totalBytes = 0;
        let storedPath: string | null = null;
        let size = 0;
        let complete = false;
        for (let index = 0; index < MAX_CHUNKS; index += 1) {
          signal.throwIfAborted();
          const result = await workflowRunArtifactRead({
            sessionId,
            runId,
            artifactId,
            version,
            offset,
            limit: CHUNK_BYTES,
          });
          signal.throwIfAborted();
          mediaType = result.mediaType;
          totalBytes = result.totalBytes;
          storedPath = result.storedPath ?? storedPath;
          const chunk = decodeBase64(result.dataBase64);
          size += chunk.length;
          if (size > PROTOCOL_V4_LIMITS.attachmentMaxBytes || totalBytes > PROTOCOL_V4_LIMITS.attachmentMaxBytes) throw new Error(translate("Workflow artifact exceeds the size limit."));
          chunks.push(chunk);
          if (result.nextOffset === null) { complete = true; break; }
          if (result.nextOffset <= offset) throw new Error(translate("Workflow artifact data is incomplete."));
          offset = result.nextOffset;
        }
        if (!complete || size !== totalBytes) throw new Error(translate("Workflow artifact data is incomplete."));
        const bytes = new Uint8Array(size);
        let cursor = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, cursor);
          cursor += chunk.length;
        }
        return { bytes, mediaType, totalBytes, storedPath };
      } catch (caught) {
        if (signal.aborted) throw caught;
        const message = caught instanceof Error ? caught.message : String(caught);
        logger.warn("[workflow-artifacts] 读取产物字节失败", {
          artifactId,
          error: message,
          runId,
          sessionId,
          version,
        });
        throw caught;
      }
    },
  }, queryClient);
  const data = enabled ? query.data : undefined;
  const blob = useMemo(() => data ? new Blob([data.bytes], { type: data.mediaType }) : null, [data]);
  useEffect(() => {
    if (!blob) { setPreview(undefined); return; }
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : null;
    setPreview({ blob, url });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [blob]);
  useEffect(() => {
    if (!enabled && !queryClient.getQueryCache().find({ queryKey, exact: true })?.isActive()) {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  }, [enabled, artifactId, runId, sessionId, version, workflowRunArtifactRead]);
  if (!enabled) return emptyState();
  return {
    ...emptyState(), ...data, blob,
    objectUrl: preview?.blob === blob ? preview?.url ?? null : null,
    loading: query.isFetching,
    error: query.error ? String(query.error).replace(/^Error: /, "") : null,
  };
}
