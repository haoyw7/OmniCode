import { faceState } from "./workflow-face-motion.js";
import { Omi } from "../../../../../shared/ui/branding/Omi";
import {
  PROJECT_MASCOTS,
  type ProjectMascot,
} from "../../../../projects/model/projectMascots";
import { cn } from "../../../../../shared/lib/cn";
import type { StepRunStatus } from "../workflow-graph/types.js";

/** Omi expression and color preserve stable subagent identity. */
export const FACE_COLORS = [
  "var(--color-agent-teal)",
  "var(--color-agent-amber)",
  "var(--color-agent-indigo)",
  "var(--color-agent-violet)",
  "var(--color-agent-blue)",
  "var(--color-agent-orange)",
  "var(--color-agent-pink)",
  "var(--color-agent-green)",
  "var(--color-agent-red)",
] as const;

/** 名字散列选色（31 进制取模 360 后映射到九色板）；只在没有 `avatarIndex` 时兜底。 */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return FACE_COLORS[hash % FACE_COLORS.length]!;
}

/** 代理的颜色：编号优先（九色环循环），缺席时退回名字散列。药丸悬停描边与脸共用它。 */
export function agentColor(avatarIndex: number | undefined, name: string): string {
  if (avatarIndex === undefined) return avatarColor(name);
  return FACE_COLORS[
    ((avatarIndex % FACE_COLORS.length) + FACE_COLORS.length) % FACE_COLORS.length
  ]!;
}

/** The agent's mascot: by number when there is one, else by name. */
export function agentMascot(avatarIndex: number | undefined, name: string): ProjectMascot {
  const count = PROJECT_MASCOTS.length;
  if (avatarIndex !== undefined) return PROJECT_MASCOTS[((avatarIndex % count) + count) % count]!;
  let hash = 0;
  for (const char of name) hash = (hash * 131 + (char.codePointAt(0) ?? 0)) >>> 0;
  return PROJECT_MASCOTS[hash % count]!;
}

export function WorkflowAgentFace({
  avatarIndex,
  className,
  name,
  status,
}: {
  avatarIndex: number | undefined;
  className?: string;
  name: string;
  status: StepRunStatus | undefined;
}) {
  const state = faceState(status);
  const mascot = agentMascot(avatarIndex, name);
  const active = state === "scanning";
  return (
    <Omi
      compact
      expression={state === "sad" ? "error" : state === "content" ? "done" : mascot.name}
      animated={active}
      className={cn("wf-mascot", state === "waiting" && "opacity-55", className)}
      data-face-state={state}
      data-subagent-avatar
      style={{ color: agentColor(avatarIndex, name) }}
    />
  );
}
