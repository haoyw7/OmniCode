import { queryClient } from "../../../shared/lib/queryClient";
// Adapted from ZCode (Apache-2.0).
import { processFile, type DiffLineAnnotation } from "@pierre/diffs";
import { buildUnifiedFile, type UnifiedLine } from "./unifiedDiff";

export type ReviewSource =
  | "unstaged"
  | "staged"
  | "uncommitted"
  | "branch"
  | "session"
  | `commit:${string}`;

/** The commit SHA of a `commit:` source, if it is one. */
export function reviewCommit(source: ReviewSource): string | undefined {
  return source.startsWith("commit:") ? source.slice(7) : undefined;
}
/** Sources that change with the working tree (session sources follow checkpoints). */
export const WORKTREE_REVIEW_SOURCES: readonly ReviewSource[] = [
  "unstaged",
  "staged",
  "uncommitted",
  "branch",
];
export type ReviewScope = {
  cwd: string;
  source: ReviewSource;
  sessionId?: string;
  turnId?: string;
};
export type ReviewFile = {
  path: string;
  relative: string;
  status: string;
  additions: number;
  deletions: number;
};
export type ReviewDiff = {
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
};
export type ReviewLoadedDiff = ReviewDiff & {
  unified: ReturnType<typeof buildUnifiedFile> | null;
  /** Scoped snapshot identity for Pierre's bounded highlighting cache. */
  cacheKey?: string;
};
export type ReviewDiffState =
  | { state: "loading" }
  | { state: "loaded"; diff: ReviewLoadedDiff }
  | { state: "error"; error: string };

export function reviewScopeKey(scope: ReviewScope) {
  return JSON.stringify([scope.cwd, scope.source, scope.sessionId ?? "", ...(scope.turnId ? [scope.turnId] : [])]);
}
export function reviewDiffKey(scope: ReviewScope, path: string) {
  return JSON.stringify([scope.cwd, scope.source, scope.sessionId ?? "", path, ...(scope.turnId ? [scope.turnId] : [])]);
}

const MAX_RICH_CHARS = 180_000;
const MAX_RICH_LINES = 1_200;
export const REVIEW_VIRTUAL_HEIGHT = 560;

function exceedsLines(text: string, limit: number) {
  let lines = text ? 1 : 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10 && ++lines > limit) return true;
  }
  return lines > limit;
}

export function prepareReviewDiff(diff: ReviewDiff): ReviewLoadedDiff {
  if (diff.binary || diff.tooLarge) return { ...diff, unified: null };
  // Git blobs can use LF while a Windows checkout uses CRLF. Compare a
  // consistent text snapshot, also shared by Pierre and hunk staging so their
  // character offsets stay aligned. Preserve other whitespace and EOF newlines.
  const original = diff.original.replace(/\r\n/g, "\n");
  const current = diff.current.replace(/\r\n/g, "\n");
  return {
    ...diff,
    original,
    current,
    unified: buildUnifiedFile(original, current),
  };
}

/** Size changes the rendering strategy, never whether fetched text is shown. */
export function virtualizeReviewDiff(diff: ReviewLoadedDiff): boolean {
  if (!diff.unified) return false;
  let lines = 0;
  let chars = 0;
  for (const block of diff.unified.blocks) {
    if (block.kind !== "hunk") continue;
    lines += block.lines.length;
    if (lines > MAX_RICH_LINES) return true;
    for (const line of block.lines) {
      chars += line.text.length + 1;
      if (chars > MAX_RICH_CHARS) return true;
    }
  }
  return false;
}

let reviewCacheId = 0, reviewSnapshotId = 0;
const REVIEW_LOADING: ReviewDiffState = { state: "loading" };
/** Query stores diffs; the queue only bounds native diff processing to four readers. */
export class ReviewDiffCache {
  private readonly prefix = ["reviewDiff", ++reviewCacheId] as const;
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private disposed = false;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly fetchDiff: (scope: ReviewScope, path: string) => Promise<ReviewDiff>,
    changed: () => void,
    private readonly concurrency = 4,
  ) {
    this.unsubscribe = queryClient.getQueryCache().subscribe(event => {
      if (!this.disposed && event.type === "updated" && (event.action.type === "success" || event.action.type === "error") && event.query.queryKey[0] === this.prefix[0] && event.query.queryKey[1] === this.prefix[1]) changed();
    });
  }
  private key(scope: ReviewScope, path?: string) { return [...this.prefix, reviewScopeKey(scope), ...(path === undefined ? [] : [path])]; }
  get(scope: ReviewScope, path: string): ReviewDiffState | undefined {
    const value = queryClient.getQueryState<ReviewDiffState>(this.key(scope, path));
    if (!value) return;
    if (value.status === "error") return { state: "error", error: value.error instanceof Error ? value.error.message : String(value.error) };
    return value.data ?? REVIEW_LOADING;
  }
  invalidate(scope: ReviewScope) { queryClient.removeQueries({ queryKey: this.key(scope) }); }
  load(scope: ReviewScope, path: string) {
    const queryKey = this.key(scope, path);
    if (this.disposed || queryClient.getQueryState(queryKey)) return;
    const snapshot = ++reviewSnapshotId;
    void queryClient.fetchQuery({
      queryKey, staleTime: Infinity, structuralSharing: false,
      queryFn: ({ signal }) => new Promise<ReviewDiffState>((resolve, reject) => {
        this.queue.push(async () => {
          try {
            signal.throwIfAborted();
            if (this.disposed) throw new Error("Review disposed");
            const diff = await this.fetchDiff(scope, path);
            signal.throwIfAborted();
            resolve({ state: "loaded", diff: { ...prepareReviewDiff(diff), cacheKey: JSON.stringify([reviewDiffKey(scope, path), snapshot]) } });
          } catch (error) { reject(error); }
        });
        this.drain();
      }),
    }).catch(() => undefined);
  }
  dispose() {
    this.disposed = true; this.unsubscribe(); this.queue = [];
    queryClient.removeQueries({ queryKey: this.prefix });
  }
  private drain() {
    while (!this.disposed && this.running < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!;
      this.running++;
      void task().finally(() => { this.running--; this.drain(); });
    }
  }
}

// ReviewDiffViewer's measured code row and Pierre's hunk separator heights.
const DIFF_LINE_HEIGHT = 17;
const DIFF_HUNK_HEIGHT = 32;
const DIFF_NOTICE_HEIGHT = 48;
const DIFF_DEFAULT_CONTEXT = 6;

/** Estimated expanded diff height, so virtualized cards start near their real size. */
export function estimateReviewBodyHeight(
  file: Pick<ReviewFile, "additions" | "deletions">,
  state?: ReviewDiffState,
): number {
  if (state?.state === "error") return DIFF_NOTICE_HEIGHT;
  if (state?.state === "loaded") {
    const { unified, binary, tooLarge } = state.diff;
    if (binary || tooLarge || !unified) return DIFF_NOTICE_HEIGHT;
    if (virtualizeReviewDiff(state.diff)) return REVIEW_VIRTUAL_HEIGHT;
    let lines = 0;
    let hunks = 0;
    for (const block of unified.blocks)
      if (block.kind === "hunk") {
        hunks++;
        lines += block.lines.length;
      }
    if (!lines) return DIFF_NOTICE_HEIGHT;
    return (
      Math.min(lines, MAX_RICH_LINES) * DIFF_LINE_HEIGHT +
      hunks * DIFF_HUNK_HEIGHT
    );
  }
  const changed = file.additions + file.deletions;
  if (!changed) return DIFF_NOTICE_HEIGHT;
  return (
    Math.min(changed + DIFF_DEFAULT_CONTEXT, MAX_RICH_LINES) *
      DIFF_LINE_HEIGHT +
    DIFF_HUNK_HEIGHT
  );
}

/** Resolve Pierre's side/number through OmniCode's diff, preserving deleted-line comments. */
export function reviewCommentLine(
  lines: readonly UnifiedLine[],
  side: "additions" | "deletions",
  number: number,
): UnifiedLine | undefined {
  return lines.find(
    (line) =>
      line.kind !== "hunk" &&
      (side === "deletions"
        ? line.oldNumber === number
        : line.newNumber === number),
  );
}

/** One action per CodeMirror chunk, even when Pierre groups several chunks into one hunk. */
export function reviewStageAnnotations(
  lines: readonly UnifiedLine[],
): DiffLineAnnotation<number>[] {
  const chunks = new Map<number, UnifiedLine>();
  for (const line of lines) {
    if (line.pos == null || (line.kind !== "add" && line.kind !== "del"))
      continue;
    const previous = chunks.get(line.pos);
    if (!previous || (previous.kind === "del" && line.kind === "add"))
      chunks.set(line.pos, line);
  }
  return [...chunks].map(([pos, line]) => ({
    side: line.kind === "del" ? "deletions" : "additions",
    lineNumber: (line.kind === "del" ? line.oldNumber : line.newNumber)!,
    metadata: pos,
  }));
}

/** Feed Pierre our existing line diff, so comments and chunk actions refer to exactly
 * the displayed changes (the two diff algorithms can disagree on repeated lines).
 * Small files keep unchanged-context expansion. Larger files use patch-only
 * metadata to avoid tokenizing their entire contents on the main thread. */
export function reviewFileMetadata(relative: string, diff: ReviewLoadedDiff) {
  if (!diff.unified || diff.binary || diff.tooLarge) return undefined;
  // Paths are supplied separately; a synthetic header also handles tabs/newlines in names.
  const patch = ["--- review", "+++ review"];
  let oldStart = 1;
  let newStart = 1;
  const oldLast = diff.original.split("\n").length;
  const newLast = diff.current.split("\n").length;
  for (const block of diff.unified.blocks) {
    const oldCount = block.lines.filter(
      (line) => line.oldNumber != null,
    ).length;
    const newCount = block.lines.filter(
      (line) => line.newNumber != null,
    ).length;
    if (block.kind === "hunk") {
      patch.push(
        `@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`,
      );
      for (const line of block.lines) {
        patch.push(
          `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
        );
        if (
          (line.oldNumber === oldLast && !diff.original.endsWith("\n")) ||
          (line.newNumber === newLast && !diff.current.endsWith("\n"))
        ) {
          patch.push("\\ No newline at end of file");
        }
      }
    }
    oldStart += oldCount;
    newStart += newCount;
  }
  const patchText = `${patch.join("\n")}\n`;
  const patchOnly =
    diff.original.length + diff.current.length > MAX_RICH_CHARS ||
    exceedsLines(diff.original, MAX_RICH_LINES) ||
    exceedsLines(diff.current, MAX_RICH_LINES);
  const metadata = processFile(patchText, {
    cacheKey: diff.cacheKey,
    oldFile: patchOnly
      ? undefined
      : { name: relative, contents: diff.original },
    newFile: patchOnly ? undefined : { name: relative, contents: diff.current },
    throwOnError: true,
  });
  if (metadata) {
    metadata.name = relative;
    metadata.prevName = relative;
    // Keep large patches cheap to tokenize. Their full text, line numbers,
    // additions/deletions and hunk actions remain available.
    if (virtualizeReviewDiff(diff)) metadata.lang = "text";
  }
  return metadata;
}
