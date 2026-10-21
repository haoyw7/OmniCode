import { parseAsJson, useQueryState } from "nuqs";
import { useCallback } from "react";
import { z } from "zod";
import type { ReviewSource } from "./reviewDiff";

const sourceSchema = z.custom<ReviewSource>(value => typeof value === "string" &&
  (["unstaged", "staged", "uncommitted", "branch", "session"].includes(value) || /^commit:[0-9a-f]{4,64}$/i.test(value)));
const parser = parseAsJson(z.record(z.string(), sourceSchema)).withDefault({});

export function useReviewTab(cwd: string, sessionId: string | undefined, turnId: string | undefined, initial: ReviewSource) {
  // Several reviews can coexist in one window. Keep each scope independent.
  const [sources, setSources] = useQueryState("review", parser);
  const scope = JSON.stringify([cwd, sessionId ?? "", turnId ?? ""]);
  const setSource = useCallback((next: ReviewSource) => setSources(current => ({ ...current, [scope]: next })), [scope, setSources]);
  return [sources[scope] ?? initial, setSource] as const;
}
