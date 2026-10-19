import { beforeEach, expect, it, vi } from "vitest";
import {
  captureSessionCheckpoint,
  prepareSessionCheckpoint,
} from "../../features/sessions/model/checkpoint";
import { trackSessionEdits } from "./sessionEditTracking";

vi.mock("../../features/sessions/model/checkpoint", () => ({
  captureSessionCheckpoint: vi.fn(async () => undefined),
  prepareSessionCheckpoint: vi.fn(async () => undefined),
  notifyReviewChanged: vi.fn(),
}));
vi.mock("../../features/connections/files/model/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
}));
vi.mock("../../features/connections/files/model/fileTree", () => ({
  notifyDirsChanged: vi.fn(),
}));
vi.mock("../../features/connections/files/model/fileWatch", () => ({
  invalidateWatchedFiles: vi.fn(),
  nudgeWatchedFiles: vi.fn(),
}));
vi.mock("../../platform/tauri/fs", () => ({ notifyGitChanged: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it("attributes a completed edit to the paths its start reported", () => {
  trackSessionEdits("s1", "/repo", {
    type: "tool.started",
    callId: "edit-1",
    kind: "edit",
    paths: ["/repo/a.ts"],
  });
  expect(prepareSessionCheckpoint).toHaveBeenCalledWith("s1", "/repo", ["/repo/a.ts"]);
  // Some providers complete an edit without its kind or paths.
  trackSessionEdits("s1", "/repo", {
    type: "tool.updated",
    callId: "edit-1",
    status: "completed",
  });
  expect(captureSessionCheckpoint).toHaveBeenCalledWith("s1", "/repo", ["/repo/a.ts"]);
  // The call is forgotten once it completes.
  trackSessionEdits("s1", "/repo", {
    type: "tool.updated",
    callId: "edit-1",
    status: "completed",
  });
  expect(captureSessionCheckpoint).toHaveBeenCalledTimes(1);
});

it("never attributes a failed edit", () => {
  trackSessionEdits("s1", "/repo", {
    type: "tool.started",
    callId: "edit-2",
    kind: "edit",
    paths: ["/repo/b.ts"],
  });
  trackSessionEdits("s1", "/repo", {
    type: "tool.updated",
    callId: "edit-2",
    status: "failed",
  });
  trackSessionEdits("s1", "/repo", {
    type: "tool.updated",
    callId: "edit-2",
    status: "completed",
  });
  expect(captureSessionCheckpoint).not.toHaveBeenCalled();
});
