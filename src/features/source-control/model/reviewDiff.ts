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
  return JSON.stringify([scope.cwd, scope.source, scope.sessionId ?? ""]);
}
export function reviewDiffKey(scope: ReviewScope, path: string) {
  return JSON.stringify([scope.cwd, scope.source, scope.sessionId ?? "", path]);
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
  return {
    ...diff,
    unified:
      diff.binary || diff.tooLarge
        ? null
        : buildUnifiedFile(diff.original, diff.current),
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

/** Lazy cache shared across source switches. A refresh invalidates pending results too. */
export class ReviewDiffCache {
  private states = new Map<string, ReviewDiffState>();
  private versions = new Map<string, number>();
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private disposed = false;

  constructor(
    private readonly fetchDiff: (
      scope: ReviewScope,
      path: string,
    ) => Promise<ReviewDiff>,
    private readonly changed: () => void,
    private readonly concurrency = 4,
  ) {}

  get(scope: ReviewScope, path: string) {
    return this.states.get(reviewDiffKey(scope, path));
  }

  invalidate(scope: ReviewScope) {
    const scopeKey = reviewScopeKey(scope);
    this.versions.set(scopeKey, (this.versions.get(scopeKey) ?? 0) + 1);
    for (const key of this.states.keys()) {
      const [cwd, source, sessionId] = JSON.parse(key) as string[];
      if (
        reviewScopeKey({ cwd, source: source as ReviewSource, sessionId }) ===
        scopeKey
      )
        this.states.delete(key);
    }
  }

  load(scope: ReviewScope, path: string) {
    const key = reviewDiffKey(scope, path);
    if (this.disposed || this.states.has(key)) return;
    const scopeKey = reviewScopeKey(scope);
    const version = this.versions.get(scopeKey) ?? 0;
    const valid = () =>
      !this.disposed && (this.versions.get(scopeKey) ?? 0) === version;
    this.states.set(key, { state: "loading" });
    this.queue.push(async () => {
      if (!valid()) return;
      try {
        const diff = await this.fetchDiff(scope, path);
        if (!valid()) return;
        this.states.set(key, {
          state: "loaded",
          diff: {
            ...prepareReviewDiff(diff),
            cacheKey: JSON.stringify([key, version]),
          },
        });
      } catch (error) {
        if (!valid()) return;
        this.states.set(key, {
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (valid()) this.changed();
    });
    this.drain();
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
    this.states.clear();
  }

  private drain() {
    while (
      !this.disposed &&
      this.running < this.concurrency &&
      this.queue.length
    ) {
      const task = this.queue.shift()!;
      this.running++;
      void task().finally(() => {
        this.running--;
        this.drain();
      });
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

/** Resolve Pierre's side/number through Monocode's diff, preserving deleted-line comments. */
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
