import { describe, expect, it, vi } from "vitest";
import { stageChunkText } from "../../connections/files/editor/editorGit";
import { LINE_DIFF_CONFIG } from "./lineDiff";
import { buildUnifiedFile } from "./unifiedDiff";
import { formatDiffComment } from "./diffComment";
import {
  estimateReviewBodyHeight,
  ReviewDiffCache,
  prepareReviewDiff,
  reviewCommentLine,
  reviewDiffKey,
  reviewFileMetadata,
  reviewStageAnnotations,
  virtualizeReviewDiff,
  REVIEW_VIRTUAL_HEIGHT,
  type ReviewDiff,
  type ReviewLoadedDiff,
  type ReviewScope,
} from "./reviewDiff";

const scope: ReviewScope = {
  cwd: "/repo",
  source: "unstaged",
  sessionId: "s1",
};
const textDiff = (current: string): ReviewDiff => ({
  original: "old\n",
  current,
  binary: false,
  tooLarge: false,
});
const loaded = (original: string, current: string): ReviewLoadedDiff => ({
  original,
  current,
  binary: false,
  tooLarge: false,
  unified: buildUnifiedFile(original, current),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let n = 0; n < 6; n++) await Promise.resolve();
};

describe("review lazy cache", () => {
  it("isolates project/source/session/path and reuses an already loaded comparison", async () => {
    const fetch = vi.fn(async () => textDiff("new\n"));
    const cache = new ReviewDiffCache(fetch, vi.fn());
    const scopes = [
      scope,
      { ...scope, source: "staged" as const },
      { ...scope, source: "session" as const },
      { ...scope, sessionId: "s2" },
      { ...scope, cwd: "/other" },
    ];
    expect(new Set(scopes.map((s) => reviewDiffKey(s, "a.ts"))).size).toBe(5);
    for (const request of scopes) cache.load(request, "a.ts");
    await flush();
    cache.load(scope, "a.ts");
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(cache.get(scope, "a.ts")?.state).toBe("loaded");
    expect(cache.get(scope, "b.ts")).toBeUndefined();
  });

  it("bounds concurrency and drops invalidated queued, stale success and stale error responses", async () => {
    const requests: ReturnType<typeof deferred<ReviewDiff>>[] = [];
    const fetch = vi.fn(() => {
      const next = deferred<ReviewDiff>();
      requests.push(next);
      return next.promise;
    });
    const changed = vi.fn();
    const cache = new ReviewDiffCache(fetch, changed, 2);
    for (const file of ["a", "b", "c", "d"]) cache.load(scope, file);
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.invalidate(scope);
    cache.load(scope, "a");
    requests[0].resolve(textDiff("stale\n"));
    requests[1].reject(new Error("stale error"));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(cache.get(scope, "a")).toEqual({ state: "loading" });
    expect(cache.get(scope, "b")).toBeUndefined();
    requests[2].resolve(textDiff("fresh\n"));
    await flush();
    const state = cache.get(scope, "a");
    expect(state?.state === "loaded" && state.diff.current).toBe("fresh\n");
    expect(changed).toHaveBeenCalledTimes(1);
    cache.dispose();
  });

  it("does not publish a response after the pane unmounts", async () => {
    const request = deferred<ReviewDiff>();
    const changed = vi.fn();
    const cache = new ReviewDiffCache(() => request.promise, changed);
    cache.load(scope, "a");
    cache.dispose();
    request.resolve(textDiff("late\n"));
    await flush();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("Pierre line/chunk bridge", () => {
  it("uses patch-only metadata for large sparse edits while preserving absolute line/chunk numbers", () => {
    const original =
      Array.from({ length: 2_000 }, (_, index) => `line ${index + 1}`).join(
        "\n",
      ) + "\n";
    const current = original.replace("line 1900\n", "changed\n");
    const diff = loaded(original, current);
    diff.cacheKey = "snapshot";
    const metadata = reviewFileMetadata("large.ts", diff)!;
    expect(metadata.isPartial).toBe(true);
    expect(metadata.cacheKey).toBe("snapshot");
    expect(metadata.additionLines.length).toBeLessThan(20);
    const [annotation] = reviewStageAnnotations(diff.unified!.lines);
    expect(annotation.lineNumber).toBe(1900);
    expect(
      reviewCommentLine(diff.unified!.lines, "additions", 1900)?.text,
    ).toBe("changed");
    expect(
      stageChunkText(
        original,
        current,
        annotation.metadata,
        null,
        LINE_DIFF_CONFIG,
      ),
    ).toBe(current);
  });

  it("keeps every changed line in large patches and switches to virtual rendering", () => {
    const diff = loaded("", "new\n".repeat(2_000));
    const metadata = reviewFileMetadata("huge.ts", diff)!;
    expect(metadata.additionLines).toHaveLength(2_000);
    expect(metadata.lang).toBe("text");
    expect(virtualizeReviewDiff(diff)).toBe(true);
    expect(estimateReviewBodyHeight(diff.unified!, { state: "loaded", diff }))
      .toBe(REVIEW_VIRTUAL_HEIGHT);
    expect(reviewStageAnnotations(diff.unified!.lines)[0].lineNumber).toBe(1);
    expect(reviewCommentLine(diff.unified!.lines, "additions", 2_000)?.text).toBe("new");
  });

  it("compares text beyond the old character and line limits without truncation", () => {
    const longLine = "x".repeat(2_000_001);
    const longDiff = prepareReviewDiff(textDiff(longLine));
    expect(longDiff.tooLarge).toBe(false);
    expect(reviewFileMetadata("huge.txt", longDiff)!.additionLines.join(""))
      .toContain(longLine);
    const manyLines = prepareReviewDiff(textDiff("x\n".repeat(50_001)));
    expect(manyLines.unified!.additions).toBe(50_001);
    expect(reviewFileMetadata("many.txt", manyLines)!.additionLines).toHaveLength(50_001);
  });

  it("preserves large unchanged regions without exceeding argument limits", () => {
    const context = "unchanged\n".repeat(150_000);
    const diff = prepareReviewDiff({ ...textDiff(`${context}after\n`), original: `${context}before\n` });
    expect(diff.unified!.additions).toBe(1);
    expect(diff.unified!.deletions).toBe(1);
    expect(reviewCommentLine(diff.unified!.lines, "additions", 150_001)?.text).toBe("after");
  });

  it("keeps binary and unavailable snapshot contents out of text comparison", () => {
    expect(
      prepareReviewDiff({ ...textDiff("binary"), binary: true }).unified,
    ).toBeNull();
    expect(prepareReviewDiff({ ...textDiff(""), tooLarge: true }).unified).toBeNull();
  });

  it("keeps deleted, added and shifted context comment numbers", () => {
    const diff = loaded("one\nremoved\nthree\n", "one\nadded\nextra\nthree\n");
    const lines = diff.unified!.lines;
    expect(
      formatDiffComment(
        { path: "a.ts", line: reviewCommentLine(lines, "deletions", 2)! },
        "Keep it",
      ),
    ).toContain("`a.ts:2` (deleted line)");
    expect(reviewCommentLine(lines, "additions", 2)).toMatchObject({
      kind: "add",
      text: "added",
      newNumber: 2,
    });
    expect(reviewCommentLine(lines, "deletions", 3)).toMatchObject({
      kind: "context",
      text: "three",
      oldNumber: 3,
      newNumber: 4,
    });
    expect(reviewCommentLine(lines, "additions", 4)).toMatchObject({
      kind: "context",
      text: "three",
      newNumber: 4,
    });
  });

  it("stages independent chunks inside a single rendered hunk, including a pure deletion", () => {
    const original = "one\nremove\nthree\nfour\nfive\nsix\nseven\n";
    const current = "one\nthree\nfour\nFIVE\nsix\nseven\n";
    const diff = loaded(original, current);
    const metadata = reviewFileMetadata("a.ts", diff)!;
    const annotations = reviewStageAnnotations(diff.unified!.lines);
    expect(metadata.hunks).toHaveLength(1);
    expect(annotations).toHaveLength(2);
    expect(
      annotations.map((annotation) => [annotation.side, annotation.lineNumber]),
    ).toEqual([
      ["deletions", 2],
      ["additions", 4],
    ]);
    expect(
      stageChunkText(
        original,
        current,
        annotations[0].metadata,
        null,
        LINE_DIFF_CONFIG,
      ),
    ).toBe("one\nthree\nfour\nfive\nsix\nseven\n");
    expect(
      stageChunkText(
        original,
        current,
        annotations[1].metadata,
        null,
        LINE_DIFF_CONFIG,
      ),
    ).toBe("one\nremove\nthree\nfour\nFIVE\nsix\nseven\n");
  });

  it.each([
    ["", "new\n"],
    ["old\n", ""],
    ["old", "new"],
    ["a\nb", "a\nb\n"],
    ["a\r\nb\r\n", "a\r\nB\r\n"],
    ["same\nsame\na\nsame\n", "same\na\nsame\nsame\n"],
  ])(
    "feeds Pierre the same numbered changes for %j → %j",
    (original, current) => {
      const diff = loaded(original, current);
      const metadata = reviewFileMetadata("dir/file.ts", diff)!;
      expect(metadata.isPartial).toBe(false);
      expect(metadata.name).toBe("dir/file.ts");
      expect(metadata.hunks.reduce((n, h) => n + h.additionLines, 0)).toBe(
        diff.unified!.additions,
      );
      expect(metadata.hunks.reduce((n, h) => n + h.deletionLines, 0)).toBe(
        diff.unified!.deletions,
      );
      for (const annotation of reviewStageAnnotations(diff.unified!.lines)) {
        const line = reviewCommentLine(
          diff.unified!.lines,
          annotation.side,
          annotation.lineNumber,
        )!;
        expect(line.pos).toBe(annotation.metadata);
        expect(line.kind).toBe(annotation.side === "additions" ? "add" : "del");
        expect(
          stageChunkText(
            original,
            current,
            annotation.metadata,
            null,
            LINE_DIFF_CONFIG,
          ),
        ).not.toBeNull();
      }
    },
  );
});

describe("estimateReviewBodyHeight", () => {
  it("sizes loaded hunks exactly and pending files from their counts", () => {
    const diff = prepareReviewDiff({
      original: "a\nb\nc\n",
      current: "a\nB\nc\n",
      binary: false,
      tooLarge: false,
    });
    const lines = diff
      .unified!.blocks.filter((block) => block.kind === "hunk")
      .reduce((sum, block) => sum + block.lines.length, 0);
    expect(
      estimateReviewBodyHeight(
        { additions: 1, deletions: 1 },
        { state: "loaded", diff },
      ),
    ).toBe(lines * 17 + 32);
    expect(estimateReviewBodyHeight({ additions: 3, deletions: 1 })).toBe(
      (4 + 6) * 17 + 32,
    );
    expect(estimateReviewBodyHeight({ additions: 1e6, deletions: 0 })).toBe(
      1200 * 17 + 32,
    );
    expect(
      estimateReviewBodyHeight(
        { additions: 9, deletions: 9 },
        { state: "loaded", diff: { ...diff, binary: true } },
      ),
    ).toBe(48);
  });
});
