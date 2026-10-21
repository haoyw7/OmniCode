// 已结束的运行行持续显示，直到用户打开会话；确认记录由本设备持久化。
import { useMemo } from "react";
import { useStore } from "zustand";
import { devicePreferences } from "../../../../shared/lib/persistedPreferences";

const KEY = "omnicode-workflow-run-acknowledged";
const LIMIT = 256;

function decode(raw: string | null): Set<string> {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === "string").slice(-LIMIT));
  } catch { return new Set(); }
}

export function acknowledgeWorkflowRuns(runIds: readonly string[]) {
  let raw: string | null = null;
  try { raw = devicePreferences.getItem(KEY); } catch { /* Storage may be unavailable. */ }
  const next = decode(raw);
  const size = next.size;
  for (const id of runIds) next.add(id);
  if (next.size === size) return;
  while (next.size > LIMIT) next.delete(next.values().next().value!);
  try { devicePreferences.setItem(KEY, JSON.stringify([...next]), true); } catch {
    // 存储失败时本窗口仍保留确认；外部变更会重新加载已保存的集合。
  }
}

export function useWorkflowRunAcknowledged(): (runId: string) => boolean {
  const raw = useStore(devicePreferences.store(KEY), state => state.value);
  return useMemo(() => {
    const acknowledged = decode(raw);
    return (runId: string) => acknowledged.has(runId);
  }, [raw]);
}
