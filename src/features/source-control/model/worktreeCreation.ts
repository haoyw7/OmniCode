/** Live log for the draft worktree that a conversation's first send creates. */
export type WorktreeLogLine =
  /** Application text with an [info] tag; translated at render time. */
  | { kind: "info"; key: string; values?: Record<string, string> }
  /** Application text without a tag; translated at render time. */
  | { kind: "text"; key: string; values?: Record<string, string> }
  /** Git output, shown verbatim. */
  | { kind: "output"; text: string }
  | { kind: "error"; text: string };

/** How long a finished creation's log stays open before it folds away. */
export const WORKTREE_CREATION_FOLD_MS = 2000;

export type WorktreeCreation = {
  id: string;
  base: string;
  status: "creating" | "created" | "failed";
  /** The user message that started the creation; its card sits under that message. */
  afterBlockId?: string;
  /** Set once a created worktree's log has been shown long enough to fold away. */
  folded?: boolean;
  log: WorktreeLogLine[];
  path?: string;
};

export function startWorktreeCreation(
  base: string,
  id: string,
): WorktreeCreation {
  return {
    id,
    base,
    status: "creating",
    log: [
      { kind: "info", key: "Starting worktree creation" },
      { kind: "info", key: "Generating branch and worktree names…" },
    ],
  };
}

/** The label of a Git progress line such as `Updating files:  42% (3/7)`. */
function progressLabel(line: WorktreeLogLine | undefined): string | undefined {
  if (line?.kind !== "output") return undefined;
  return /^([^:]+):\s+\d{1,3}%/.exec(line.text)?.[1];
}

/**
 * Git reports progress while the working copy is still being created. A
 * progress update replaces the previous one, as Git redraws it in a terminal.
 */
export function appendWorktreeCreationLog(
  creation: WorktreeCreation,
  id: string,
  line: string,
): WorktreeCreation {
  if (creation.id !== id) return creation;
  const next: WorktreeLogLine = { kind: "output", text: line };
  const label = progressLabel(next);
  const keep =
    label !== undefined && progressLabel(creation.log.at(-1)) === label
      ? creation.log.slice(0, -1)
      : creation.log;
  return { ...creation, log: [...keep, next] };
}

export function completeWorktreeCreation(
  creation: WorktreeCreation,
  id: string,
  path: string,
): WorktreeCreation {
  if (creation.id !== id || creation.status !== "creating") return creation;
  return {
    ...creation,
    status: "created",
    path,
    log: [
      ...creation.log,
      {
        kind: "text",
        key: "Worktree created at {value0}",
        values: { value0: path },
      },
    ],
  };
}

/** Folds a finished creation's log once it has been read long enough. */
export function foldWorktreeCreation(
  creation: WorktreeCreation,
  id: string,
): WorktreeCreation {
  if (creation.id !== id || creation.status !== "created") return creation;
  return { ...creation, folded: true };
}

/** Pins the card under the message that started the creation, once. */
export function anchorWorktreeCreation(
  creation: WorktreeCreation,
  id: string,
  afterBlockId: string,
): WorktreeCreation {
  if (creation.id !== id || creation.afterBlockId) return creation;
  return { ...creation, afterBlockId };
}

export function failWorktreeCreation(
  creation: WorktreeCreation,
  id: string,
  message: string,
): WorktreeCreation {
  if (creation.id !== id || creation.status !== "creating") return creation;
  return {
    ...creation,
    status: "failed",
    log: [...creation.log, { kind: "error", text: message }],
  };
}

/**
 * The agent has not started while its worktree is being made, or while the host
 * still holds the message as unsent. Its working clock must wait for that.
 */
export function agentWaitingForWorktree(
  creation: WorktreeCreation | undefined,
  blocks: readonly { id: string; sending?: boolean }[],
): boolean {
  if (!creation) return false;
  if (creation.status === "creating") return true;
  return blocks.some(
    (block) => block.id === creation.afterBlockId && !!block.sending,
  );
}

/**
 * What a finished creation keeps on its first message, so the log survives a
 * reload. Only a worktree that exists is worth keeping.
 */
export type PersistedWorktreeCreation = {
  base: string;
  path: string;
  log: WorktreeLogLine[];
};

const MAX_LOG_LINES = 200;
const MAX_TEXT_LENGTH = 4_000;

export function persistWorktreeCreation(
  creation: WorktreeCreation,
): PersistedWorktreeCreation | undefined {
  if (creation.status !== "created" || !creation.path) return undefined;
  return { base: creation.base, path: creation.path, log: creation.log };
}

/** Reads a stored or host-sent record; anything malformed is dropped whole. */
export function parsePersistedWorktreeCreation(
  value: unknown,
): PersistedWorktreeCreation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.base !== "string" ||
    typeof record.path !== "string" ||
    !Array.isArray(record.log) ||
    record.base.length > 255 ||
    record.path.length > 4_096 ||
    record.log.length > MAX_LOG_LINES
  )
    return undefined;
  const log: WorktreeLogLine[] = [];
  for (const entry of record.log) {
    const line = parseLogLine(entry);
    if (!line) return undefined;
    log.push(line);
  }
  return { base: record.base, path: record.path, log };
}

function parseLogLine(value: unknown): WorktreeLogLine | undefined {
  if (!value || typeof value !== "object") return undefined;
  const line = value as Record<string, unknown>;
  if (line.kind === "output" || line.kind === "error") {
    if (typeof line.text !== "string" || line.text.length > MAX_TEXT_LENGTH)
      return undefined;
    return line.kind === "output"
      ? { kind: "output", text: line.text }
      : { kind: "error", text: line.text };
  }
  if (line.kind !== "info" && line.kind !== "text") return undefined;
  if (typeof line.key !== "string" || line.key.length > MAX_TEXT_LENGTH)
    return undefined;
  let values: Record<string, string> | undefined;
  if (line.values !== undefined) {
    if (!line.values || typeof line.values !== "object" || Array.isArray(line.values))
      return undefined;
    const entries = Object.entries(line.values as Record<string, unknown>);
    if (entries.some(([, text]) => typeof text !== "string" || text.length > MAX_TEXT_LENGTH))
      return undefined;
    values = Object.fromEntries(entries as [string, string][]);
  }
  const key = line.key;
  return line.kind === "info"
    ? { kind: "info", key, ...(values ? { values } : {}) }
    : { kind: "text", key, ...(values ? { values } : {}) };
}

/** A creation read back from its first message: finished, and folded until opened. */
export function worktreeCreationFromRecord(
  id: string,
  record: PersistedWorktreeCreation,
): WorktreeCreation {
  return {
    id,
    base: record.base,
    status: "created",
    afterBlockId: id,
    folded: true,
    log: record.log,
    path: record.path,
  };
}
