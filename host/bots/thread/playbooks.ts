import type { BotPlaybook } from "../../../src/features/bots/model/botView";
import { redactSecrets } from "./memory";
import { bm25Scores, tokenizeMemorySearch } from "./memorySearch";

/**
 * Procedures the user taught the assistant or it worked out, kept as one
 * SKILL.md-style document each: name and when-to-use description up front,
 * steps and pitfalls in the body. Prompts list only names and descriptions;
 * the body is read when a task needs it, like agent skills.
 */
export const PLAYBOOK_PREFIX = "playbook:";
export const MAX_PLAYBOOKS = 50;
const MAX_DESCRIPTION_CHARS = 300;
export const MAX_PLAYBOOK_BYTES = 32 * 1024;

export type Playbook = BotPlaybook;
export type PlaybookSummary = Omit<Playbook, "body">;

export function playbookName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new Error(
      "name must be lowercase letters, numbers and single dashes, like deploy-staging",
    );
  return name;
}

export function playbookDescription(value: unknown): string {
  const description =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!description || description.length > MAX_DESCRIPTION_CHARS)
    throw new Error(
      `description must say when to use it in at most ${MAX_DESCRIPTION_CHARS} characters`,
    );
  return description;
}

/**
 * The saved document for a new or changed playbook. A change keeps the last
 * verified run unless this save records a new one; secrets are redacted.
 */
export function playbookDocument(
  input: { name: unknown; description: unknown; body: unknown; verified?: boolean },
  previous: Playbook | undefined,
  today: string,
): string {
  const body = typeof input.body === "string" ? redactSecrets(input.body).trim() : "";
  if (!body) throw new Error("body must describe the steps");
  const verified = input.verified ? today : previous?.verified;
  const text = formatPlaybook({
    name: playbookName(input.name),
    description: playbookDescription(
      typeof input.description === "string" ? redactSecrets(input.description) : "",
    ),
    body,
    updated: today,
    ...(verified ? { verified } : {}),
  });
  if (new TextEncoder().encode(text).length > MAX_PLAYBOOK_BYTES)
    throw new Error("Playbook is too long; keep only what the next run needs");
  return text;
}

/** An agent skill copy: agents read only name, description and the steps. */
export function playbookSkill(playbook: Playbook): string {
  return [
    "---",
    `name: ${playbook.name}`,
    `description: ${JSON.stringify(playbook.description)}`,
    "---",
    "",
    playbook.body.trim(),
    "",
  ].join("\n");
}

/**
 * Snapshot explicitly assigned procedures into the task message. Keeping them
 * in the message works across providers and preserves queued/history content
 * even if a playbook is later changed or deleted.
 */
export function assignedPlaybookPrompt(
  text: unknown,
  selection: unknown,
  playbooks: readonly Playbook[],
  maxChars = 256_000,
): string {
  if (typeof text !== "string" || text.includes("\0"))
    throw new Error("Invalid task message");
  const names = typeof selection === "string" ? [selection] : selection;
  if (!Array.isArray(names) || names.length > MAX_PLAYBOOKS)
    throw new Error(
      `playbooks must be a name or a list of at most ${MAX_PLAYBOOKS} names`,
    );
  const selected = [...new Set(names.map(playbookName))].map((name) => {
    const found = playbooks.find((playbook) => playbook.name === name);
    if (!found) throw new Error(`No playbook with that name: ${name}`);
    return found;
  });
  const prompt = selected.length
    ? [
        text,
        "## Assigned playbooks",
        "Follow these procedures for this task in the listed order, within the user's requested scope and the project's rules. If they conflict or required inputs are missing, ask before proceeding.",
        ...selected.map(
          (playbook) => `### ${playbook.name}\n${playbookSkill(playbook)}`,
        ),
      ].join("\n\n")
    : text;
  // Bound the complete message using the destination's limit, not each body.
  if (prompt.length > maxChars || prompt.includes("\0"))
    throw new Error(
      "Task message with playbooks is too long or invalid; choose fewer playbooks or shorten the message",
    );
  return prompt;
}

export function formatPlaybook(playbook: Playbook): string {
  return [
    "---",
    `name: ${playbook.name}`,
    `description: ${JSON.stringify(playbook.description)}`,
    `updated: ${playbook.updated}`,
    ...(playbook.verified ? [`verified: ${playbook.verified}`] : []),
    "---",
    "",
    playbook.body.trim(),
    "",
  ].join("\n");
}

export function parsePlaybook(name: string, text: string): Playbook {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = new Map<string, string>();
  for (const line of (match?.[1] ?? "").split("\n")) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) meta.set(field[1], field[2]);
  }
  let description = meta.get("description") ?? "";
  try {
    if (description.startsWith('"')) description = JSON.parse(description);
  } catch {
    // Keep a hand-edited value as written.
  }
  return {
    name,
    description,
    updated: meta.get("updated") ?? "",
    ...(meta.get("verified") ? { verified: meta.get("verified") } : {}),
    body: (match ? match[2] : text).trim(),
  };
}

/** One line per playbook for the brain's prompt. */
export function playbookIndex(playbooks: readonly PlaybookSummary[]): string {
  return playbooks
    .map(
      (p) =>
        `- ${p.name}: ${p.description}${p.verified ? ` (last worked ${p.verified})` : ""}`,
    )
    .join("\n");
}

/**
 * The playbook the user's input clearly asks for, matched on its name and
 * description. Two shared words keep ordinary requests from pulling one in.
 */
export function matchPlaybook(
  playbooks: readonly Playbook[],
  input: string,
): Playbook | undefined {
  const words = tokenizeMemorySearch(input);
  if (!words.length || !playbooks.length) return undefined;
  const documents = playbooks.map(
    (p) => `${p.name.replace(/-/g, " ")} ${p.description}`,
  );
  const scores = bm25Scores(words, documents);
  const wanted = new Set(words);
  const best = scores
    .map((score, index) => ({ score, index }))
    .filter(
      ({ score, index }) =>
        score > 0 &&
        new Set(tokenizeMemorySearch(documents[index]).filter((w) => wanted.has(w)))
          .size >= 2,
    )
    .sort((a, b) => b.score - a.score)[0];
  return best ? playbooks[best.index] : undefined;
}
