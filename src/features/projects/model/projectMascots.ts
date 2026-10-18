import type { OmiExpression } from "../../../shared/ui/branding/omiArtwork";

export type ProjectMascot = { name: OmiExpression; label: string };

/** Preserve the original roster order so existing project hashes retain their identity. */
export const PROJECT_MASCOTS: readonly ProjectMascot[] = [
  { name: "ready", label: "Ready" },
  { name: "curious", label: "Curious" },
  { name: "focused", label: "Focused" },
  { name: "joyful", label: "Joyful" },
  { name: "error", label: "Error" },
  { name: "encouraging", label: "Encouraging" },
  { name: "sleepy", label: "Sleepy" },
  { name: "inspired", label: "Inspired" },
  { name: "surprised", label: "Surprised" },
  { name: "done", label: "Complete" },
];

// Read-time migration of stored selections, not a second artwork implementation.
const LEGACY_MASCOTS: Record<string, OmiExpression> = {
  invader: "ready", ghost: "curious", robot: "focused", cat: "joyful",
  skull: "error", crab: "encouraging", mushroom: "sleepy", rocket: "inspired",
  dino: "surprised", frog: "done",
};

export function resolveProjectMascotName(name?: string | null): OmiExpression | undefined {
  if (!name) return undefined;
  const migrated = Object.hasOwn(LEGACY_MASCOTS, name) ? LEGACY_MASCOTS[name] : name;
  return PROJECT_MASCOTS.find(mascot => mascot.name === migrated)?.name;
}

/** Project appearance remains independent of provider and status. */
export function projectMascot(project: string, name?: string | null): ProjectMascot {
  const resolved = resolveProjectMascotName(name);
  const chosen = PROJECT_MASCOTS.find(mascot => mascot.name === resolved);
  if (chosen) return chosen;
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 131 + project.charCodeAt(i)) >>> 0;
  return PROJECT_MASCOTS[hash % PROJECT_MASCOTS.length];
}
