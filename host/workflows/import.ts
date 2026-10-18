// Builds the amend-resume cache (ImportedRunCache) from a predecessor run's
// journal. Adapted from ZCode's bootstrap dynamic-workflow-import.ts
// (Apache-2.0). Monocode providers own their transcripts, so a diverging actor
// is not forked from the predecessor's session: the driver starts a fresh
// session and gives it a recap of the asks it already completed. In-flight
// asks are therefore never carried over.

import type {
  ActorRecord,
  ImportedActorCandidate,
  ImportedAskEntry,
  ImportedRunCache,
  ImportedWorldEntry,
  NodeRecord,
  RunRecord,
  RunStatus,
} from "../../src/integrations/workflow/dynamic-workflow/index.js";

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "errored", "stopped"]);

interface ImportedCacheJournalReader {
  getRun(runId: string): RunRecord | undefined;
  listActors(runId: string): ActorRecord[];
  listNodes(runId: string): NodeRecord[];
}

export type ImportedCacheRefusalReason = "run_not_found" | "not_amendable" | "missing_boundaries";

export type BuildImportedCacheResult =
  | { ok: true; cache: ImportedRunCache; resumedFrom: string }
  | { ok: false; reason: ImportedCacheRefusalReason };

function completedAsksHaveBoundaries(nodes: readonly NodeRecord[]): boolean {
  return nodes.every((node) => node.kind !== "ask" || node.status !== "completed" || node.messageBoundary !== undefined);
}

/** Checks done before stopping a running predecessor, so a refused amend stops nothing. */
export function preflightAmendImport(
  journal: Pick<ImportedCacheJournalReader, "getRun" | "listNodes">,
  predecessorRunId: string,
): { ok: true; run: RunRecord } | { ok: false; reason: Exclude<ImportedCacheRefusalReason, "not_amendable"> } {
  const run = journal.getRun(predecessorRunId);
  if (run === undefined) return { ok: false, reason: "run_not_found" };
  if (!completedAsksHaveBoundaries(journal.listNodes(predecessorRunId))) return { ok: false, reason: "missing_boundaries" };
  return { ok: true, run };
}

export function buildImportedCache(journal: ImportedCacheJournalReader, predecessorRunId: string): BuildImportedCacheResult {
  const run = journal.getRun(predecessorRunId);
  if (run === undefined) return { ok: false, reason: "run_not_found" };
  if (!TERMINAL_RUN_STATUSES.has(run.status)) return { ok: false, reason: "not_amendable" };
  const nodes = journal.listNodes(predecessorRunId);
  if (!completedAsksHaveBoundaries(nodes)) return { ok: false, reason: "missing_boundaries" };

  const actors = new Map<string, ImportedActorCandidate>();
  for (const record of namedUniqueActors(journal.listActors(predecessorRunId))) {
    if (record.persona === undefined) continue;
    const entries = completedAskPrefix(nodes, record);
    if (entries.length === 0) continue;
    const source = resolveTranscriptSource(journal, record.name!, predecessorRunId);
    if (source === undefined) continue;
    actors.set(record.name!, {
      persona: record.persona,
      entries,
      transcriptSourceSessionId: source.sessionId,
      ...(source.resolvedModel === undefined ? {} : { resolvedModel: source.resolvedModel }),
    });
  }
  return { ok: true, cache: { actors, world: buildWorldQueues(nodes) }, resumedFrom: predecessorRunId };
}

function namedUniqueActors(records: ActorRecord[]): ActorRecord[] {
  const byName = new Map<string, ActorRecord[]>();
  for (const record of records) {
    if (!record.name) continue;
    byName.set(record.name, [...(byName.get(record.name) ?? []), record]);
  }
  return [...byName.values()].filter((bucket) => bucket.length === 1).map((bucket) => bucket[0]!);
}

function completedAskPrefix(nodes: NodeRecord[], actor: ActorRecord): ImportedAskEntry[] {
  const bySeq = new Map<number, NodeRecord>();
  for (const node of nodes) {
    if (node.kind !== "ask" || node.actorSiteId !== actor.siteId || node.actorOrdinal !== actor.ordinal || node.actorSeq === undefined) continue;
    bySeq.set(node.actorSeq, node);
  }
  const entries: ImportedAskEntry[] = [];
  for (let seq = 0; ; seq++) {
    const node = bySeq.get(seq);
    if (node === undefined || node.status !== "completed") return entries;
    entries.push({ inputHash: node.inputHash, result: node.result, messageBoundary: node.messageBoundary!, ...(node.stats ? { stats: node.stats } : {}) });
  }
}

/** The session holding this actor's work, following resumedFrom when it never ran live. */
function resolveTranscriptSource(journal: ImportedCacheJournalReader, actorName: string, startRunId: string): { sessionId: string; resolvedModel?: string } | undefined {
  const seen = new Set<string>();
  let runId: string | undefined = startRunId;
  while (runId !== undefined && !seen.has(runId)) {
    seen.add(runId);
    const matches = journal.listActors(runId).filter((actor) => actor.name === actorName);
    if (matches.length !== 1) return undefined;
    const actor = matches[0]!;
    if (actor.sessionId !== undefined) return { sessionId: actor.sessionId, ...(actor.resolvedModel ? { resolvedModel: actor.resolvedModel } : {}) };
    runId = journal.getRun(runId)?.resumedFrom;
  }
  return undefined;
}

function buildWorldQueues(nodes: NodeRecord[]): ReadonlyMap<string, ImportedWorldEntry[]> {
  const world = new Map<string, ImportedWorldEntry[]>();
  for (const node of nodes) {
    if ((node.kind !== "world-read" && node.kind !== "world-run") || node.status !== "completed") continue;
    const entry: ImportedWorldEntry = { inputHash: node.inputHash, kind: node.kind, result: node.result };
    world.set(node.inputHash, [...(world.get(node.inputHash) ?? []), entry]);
  }
  return world;
}
