// Artifact reads for the workflow run views. Adapted from ZCode's bootstrap
// dynamic-workflow-run-artifact-projection/queries/read modules (Apache-2.0).

import type { DatabaseSync } from "node:sqlite";
import type { JournalStorePort, NodeRecord } from "../../src/integrations/workflow/dynamic-workflow/index.js";
import type { FileArtifactStore } from "./node-ports.js";

type ArtifactKind = "file" | "markdown" | "chart" | "table" | "metrics" | "board";

const ARTIFACT_KINDS: ReadonlySet<string> = new Set<ArtifactKind>(["file", "markdown", "chart", "table", "metrics", "board"]);
const PRESET_ARTIFACT_KINDS: ReadonlySet<string> = new Set<ArtifactKind>(["chart", "table", "metrics", "board"]);

export type ArtifactVersion = {
  version: number;
  title?: string;
  description?: string;
  contentType?: string;
  bytes?: number;
  uri?: string;
  sourcePath?: string;
  spec?: unknown;
  publishedAt: number;
  primary?: true;
};

export type RunArtifact = {
  id: string;
  kind: ArtifactKind;
  title?: string;
  description?: string;
  contentType?: string;
  sourcePath?: string;
  spec?: unknown;
  version: number;
  versions: ArtifactVersion[];
  itemCount: number;
  primary?: true;
};

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function versionOf(record: Record<string, unknown>): ArtifactVersion | undefined {
  const version = record.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return undefined;
  const title = stringField(record, "title"), description = stringField(record, "description");
  const contentType = stringField(record, "contentType"), uri = stringField(record, "uri"), sourcePath = stringField(record, "sourcePath");
  return {
    version,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(typeof record.bytes === "number" && Number.isFinite(record.bytes) ? { bytes: record.bytes } : {}),
    ...(uri === undefined ? {} : { uri }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    ...(record.spec === undefined ? {} : { spec: record.spec }),
    publishedAt: typeof record.publishedAt === "number" ? record.publishedAt : 0,
    ...(record.primary === true ? { primary: true as const } : {}),
  };
}

/** Every artifact a run published, newest version first in metadata, primary first in order. */
export function artifactsOf(runId: string, journal: JournalStorePort): RunArtifact[] {
  const nodes = journal.listNodes(runId);
  const byId = new Map<string, { kind: ArtifactKind; versions: ArtifactVersion[] }>();
  for (const node of nodes) {
    if (node.kind !== "artifact" || node.status !== "completed") continue;
    const record = node.result;
    if (record === null || typeof record !== "object") continue;
    const version = versionOf(record as Record<string, unknown>);
    const id = node.artifactId ?? stringField(record as Record<string, unknown>, "id");
    const kind = (record as Record<string, unknown>).kind;
    if (!version || !id || typeof kind !== "string" || !ARTIFACT_KINDS.has(kind)) continue;
    const bucket = byId.get(id);
    if (bucket) bucket.versions.push(version);
    else byId.set(id, { kind: kind as ArtifactKind, versions: [version] });
  }
  const counts = new Map<string, number>();
  if ([...byId.values()].some((bucket) => PRESET_ARTIFACT_KINDS.has(bucket.kind)))
    for (const node of nodes) if (node.kind === "report" && node.artifactId) counts.set(node.artifactId, (counts.get(node.artifactId) ?? 0) + 1);
  const artifacts = [...byId].map(([id, bucket]): RunArtifact => {
    const versions = [...bucket.versions].sort((a, b) => a.version - b.version);
    const latest = versions.at(-1)!;
    return {
      id,
      kind: bucket.kind,
      ...(latest.title === undefined ? {} : { title: latest.title }),
      ...(latest.description === undefined ? {} : { description: latest.description }),
      ...(latest.contentType === undefined ? {} : { contentType: latest.contentType }),
      ...(latest.sourcePath === undefined ? {} : { sourcePath: latest.sourcePath }),
      ...(latest.spec === undefined ? {} : { spec: latest.spec }),
      version: latest.version,
      versions,
      itemCount: counts.get(id) ?? 0,
      ...(versions.some((version) => version.primary) ? { primary: true as const } : {}),
    };
  });
  return artifacts.sort((a, b) => Number(b.primary === true) - Number(a.primary === true));
}

/** Data items reported into a preset artifact (chart, table, metrics, board), in report order. */
export function artifactItems(db: DatabaseSync, runId: string, artifactId: string, page: { afterSequence?: number; limit: number }) {
  const limit = Math.max(1, Math.min(500, page.limit));
  const rows = db.prepare(`SELECT rowid, record FROM workflow_nodes
    WHERE run_id=? AND json_extract(record, '$.kind')='report' AND json_extract(record, '$.artifactId')=? AND rowid>?
    ORDER BY rowid LIMIT ?`).all(runId, artifactId, page.afterSequence ?? -1, limit + 1);
  const items = rows.slice(0, limit).map((row) => {
    const node = JSON.parse(String(row.record)) as NodeRecord;
    return { sequence: Number(row.rowid), siteId: node.siteId, ordinal: node.ordinal, item: node.result };
  });
  return { items, hasMore: rows.length > limit };
}

/** A byte range of one artifact version, base64 encoded. */
export async function readArtifactBytes(store: FileArtifactStore, journal: JournalStorePort, runId: string, artifactId: string, version: number | undefined, offset: number, limit: number) {
  const artifact = artifactsOf(runId, journal).find((entry) => entry.id === artifactId);
  const target = version === undefined ? artifact?.versions.at(-1) : artifact?.versions.find((entry) => entry.version === version);
  if (!target?.uri) throw new Error("This artifact version has no stored content");
  const stored = await store.read(target.uri);
  if (!stored) throw new Error("This artifact's content is no longer available");
  const start = Math.max(0, offset);
  const end = Math.min(stored.bytes.length, start + Math.max(1, Math.min(512 * 1024, limit)));
  return {
    mediaType: target.contentType ?? stored.contentType,
    totalBytes: stored.bytes.length,
    dataBase64: stored.bytes.subarray(start, end).toString("base64"),
    nextOffset: end < stored.bytes.length ? end : null,
  };
}
