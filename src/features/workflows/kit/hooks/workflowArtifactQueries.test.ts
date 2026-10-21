// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../../shared/lib/queryClient";
import { useWorkflowRunArtifacts } from "./useWorkflowRunArtifacts";
import { useWorkflowRunArtifactBytes } from "./useWorkflowRunArtifactBytes";
import { useWorkflowRunArtifactData } from "./useWorkflowRunArtifactData";

const readers = vi.hoisted(() => ({ workflowRunArtifacts: vi.fn(), workflowRunArtifactRead: vi.fn(), workflowRunArtifactData: vi.fn() }));
vi.mock("../v4/V4ConversationContext.js", () => ({ useV4Conversation: () => readers }));
vi.mock("../logger.js", () => ({ logger: { warn: vi.fn() } }));
let root: Root;
beforeEach(() => {
  queryClient.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.values(readers).forEach(read => read.mockReset());
  root = createRoot(document.createElement("div"));
});
afterEach(() => { act(() => root.unmount()); queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const target = { sessionId: "session", runId: "run", artifactId: "artifact", version: 1 };
const row = (sequence: number) => ({ sequence, siteId: "site", ordinal: sequence, item: { value: sequence } });

it("distinguishes unsupported journals from empty ones and refreshes only shape changes", async () => {
  readers.workflowRunArtifacts.mockRejectedValueOnce(new Error("capabilityUnsupported ArtifactRows"))
    .mockResolvedValue({ artifacts: [] });
  let result!: ReturnType<typeof useWorkflowRunArtifacts>;
  function View({ version, count, runId = "run" }: { version: number; count: number; runId?: string }) {
    result = useWorkflowRunArtifacts({ sessionId: "session", runId, live: [{ id: "artifact", kind: "table", version, itemCount: count }] });
    return null;
  }
  await act(async () => root.render(createElement(View, { version: 1, count: 0 })));
  expect(result.unavailable).toBe(true);
  expect(result.artifacts).toHaveLength(1);
  await act(async () => root.render(createElement(View, { version: 1, count: 5 })));
  expect(readers.workflowRunArtifacts).toHaveBeenCalledTimes(1);
  await act(async () => root.render(createElement(View, { version: 2, count: 5 })));
  expect(readers.workflowRunArtifacts).toHaveBeenCalledTimes(2);
  expect(result.unavailable).toBe(false);
  expect(result.artifacts[0].version).toBe(2);
});

it("reads byte chunks in order and releases the preview when disabled", async () => {
  readers.workflowRunArtifactRead.mockResolvedValueOnce({ dataBase64: "YWI=", mediaType: "text/plain", totalBytes: 3, nextOffset: 2 })
    .mockResolvedValueOnce({ dataBase64: "Yw==", mediaType: "text/plain", totalBytes: 3, nextOffset: null, storedPath: "/stored" });
  const make = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:artifact");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let result!: ReturnType<typeof useWorkflowRunArtifactBytes>;
  function View({ enabled }: { enabled: boolean }) { result = useWorkflowRunArtifactBytes({ ...target, enabled }); return null; }
  await act(async () => root.render(createElement(View, { enabled: true })));
  expect(new TextDecoder().decode(result.bytes!)).toBe("abc");
  expect(result.storedPath).toBe("/stored");
  expect(readers.workflowRunArtifactRead.mock.calls.map(call => call[0].offset)).toEqual([0, 2]);
  expect(make).toHaveBeenCalledOnce();
  await act(async () => root.render(createElement(View, { enabled: false })));
  expect(result.bytes).toBeNull();
  expect(result.objectUrl).toBeNull();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:artifact");
});

it.each(["oversized", "incomplete", "nonadvancing"])("does not publish %s artifact bytes", async (kind) => {
  readers.workflowRunArtifactRead.mockResolvedValue({ dataBase64: "YQ==", mediaType: "text/plain", totalBytes: kind === "oversized" ? 21 * 1024 * 1024 : 2, nextOffset: kind === "nonadvancing" ? 0 : null });
  const make = vi.spyOn(URL, "createObjectURL");
  let result!: ReturnType<typeof useWorkflowRunArtifactBytes>;
  function View() { result = useWorkflowRunArtifactBytes(target); return null; }
  await act(async () => root.render(createElement(View)));
  expect(result.error).toBeTruthy();
  expect(result.bytes).toBeNull();
  expect(make).not.toHaveBeenCalled();
});

it("coalesces signals during a drain and follows the last cursor without duplicating rows", async () => {
  let finish!: (result: { items: ReturnType<typeof row>[]; hasMore: boolean }) => void;
  readers.workflowRunArtifactData.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ items: [row(2)], hasMore: true })
    .mockResolvedValueOnce({ items: [row(2), row(3)], hasMore: false });
  let result!: ReturnType<typeof useWorkflowRunArtifactData>;
  function View({ count }: { count: number }) { result = useWorkflowRunArtifactData({ ...target, itemCount: count }); return null; }
  await act(async () => root.render(createElement(View, { count: 0 })));
  await act(async () => root.render(createElement(View, { count: 1 })));
  await act(async () => root.render(createElement(View, { count: 2 })));
  expect(readers.workflowRunArtifactData).toHaveBeenCalledTimes(1);
  await act(async () => finish({ items: [row(1)], hasMore: false }));
  expect(result.items.map(item => item.sequence)).toEqual([1, 2, 3]);
  expect(readers.workflowRunArtifactData.mock.calls.map(call => call[0].afterSequence)).toEqual([undefined, 1, 2]);
  readers.workflowRunArtifactData.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(createElement(View, { count: 3 })));
  expect(result.items).toHaveLength(3);
  expect(result.error).toBe("offline");
});

it("discards late rows from a previous run", async () => {
  let finish!: (value: unknown) => void;
  readers.workflowRunArtifactData.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ items: [row(9)], hasMore: false });
  let result!: ReturnType<typeof useWorkflowRunArtifactData>;
  function View({ runId }: { runId: string }) { result = useWorkflowRunArtifactData({ ...target, runId }); return null; }
  await act(async () => root.render(createElement(View, { runId: "old" })));
  await act(async () => root.render(createElement(View, { runId: "new" })));
  await act(async () => finish({ items: [row(1)], hasMore: false }));
  expect(result.items.map(item => item.sequence)).toEqual([9]);
});
