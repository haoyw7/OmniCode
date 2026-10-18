import type { OmiExpression, OmiShape } from "../../../shared/ui/branding/omiArtwork";

// These orders are part of the persisted avatar format; append, never reorder.
export const avatarExpressions = ["ready", "curious", "focused", "joyful", "encouraging", "sleepy", "inspired", "surprised"] as const satisfies readonly OmiExpression[];
export const avatarTones = ["violet", "blue", "teal", "amber", "rose", "green"] as const;
export const avatarShapes = ["original", "circle", "triangle", "square"] as const satisfies readonly OmiShape[];
export const avatarVariants = ["outline", "filled"] as const;
export type BotAvatarAppearance = {
  expression: typeof avatarExpressions[number];
  tone: typeof avatarTones[number];
  shape: typeof avatarShapes[number];
  variant: typeof avatarVariants[number];
};

/** Identity stays stable across Hosts, themes, renames and avatar sizes. */
export function botAvatarAppearance(id: string): BotAvatarAppearance {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  const shapeHash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return { expression: avatarExpressions[hash % avatarExpressions.length], tone: avatarTones[(hash >>> 8) % avatarTones.length], shape: avatarShapes[(shapeHash >>> 16) % avatarShapes.length], variant: avatarVariants[(hash >>> 24) % 2] };
}

/** Eight ASCII characters fit the existing Host avatar contract without new fields. */
export function encodeBotAvatar(value: BotAvatarAppearance): string {
  return `omi:${avatarShapes.indexOf(value.shape)}${avatarExpressions.indexOf(value.expression)}${avatarVariants.indexOf(value.variant)}${avatarTones.indexOf(value.tone)}`;
}

export function decodeBotAvatar(value?: string): BotAvatarAppearance | undefined {
  const match = /^omi:([0-3])([0-7])([0-1])([0-5])$/.exec(value ?? "");
  if (!match) return undefined;
  return { shape: avatarShapes[Number(match[1])], expression: avatarExpressions[Number(match[2])], variant: avatarVariants[Number(match[3])], tone: avatarTones[Number(match[4])] };
}
