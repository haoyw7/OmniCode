import type { StepRunStatus } from "../workflow-graph/types.js";

export type FaceState = "waiting" | "scanning" | "content" | "sad";
export function faceState(status: StepRunStatus | undefined): FaceState {
  return status === "running"
    ? "scanning"
    : status === "done"
      ? "content"
      : status === "failed"
        ? "sad"
        : "waiting";
}
