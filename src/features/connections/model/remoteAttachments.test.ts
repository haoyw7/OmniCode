import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readRemoteQueuedAttachments, uploadRemoteAttachments } from "./remoteAttachments";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("reads all queued attachment bytes before removing remote ownership, including non-images", async () => {
  const file = { id: "text", name: "note.txt", mimeType: "text/plain", kind: "file" as const, size: 5, path: "/host/note.txt" };
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method, params } = input as { method: string; params: { offset: number } };
    expect(method).toBe("attachments.read");
    return params.offset === 0 ? { data: "YWJj", offset: 3, size: 5 } : { data: "ZGU=", offset: 5, size: 5 };
  });
  const result = await readRemoteQueuedAttachments("machine", "session", [file]);
  expect(result).toEqual([{ ...file, data: "YWJjZGU=" }]);
  expect(file).not.toHaveProperty("data");
});

it("rejects an incomplete attachment transfer", async () => {
  const file = { id: "image", name: "image.png", mimeType: "image/png", kind: "image" as const, size: 5 };
  vi.mocked(invoke).mockResolvedValue({ data: "YWJj", offset: 5, size: 5 });
  await expect(readRemoteQueuedAttachments("machine", "session", [file])).rejects.toThrow("Invalid attachment transfer");
});

it("uploads local bytes before returning host attachment references", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "read_file_base64")
      return Buffer.from("sample").toString("base64");
    if (command === "remote_request") {
      const { method, params } = input as {
        method: string;
        params: Record<string, unknown>;
      };
      calls.push({ method, params });
      return { offset: 6 };
    }
    throw new Error(`Unexpected invoke ${command}`);
  });
  const file = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "sample.txt",
    mimeType: "text/plain",
    kind: "file" as const,
    size: 6,
    path: "/laptop/sample.txt",
  };
  const refs = await uploadRemoteAttachments("machine", [file]);
  expect(refs).toEqual([
    {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      kind: file.kind,
      size: 6,
    },
  ]);
  expect(calls).toEqual([
    {
      method: "attachments.upload",
      params: {
        id: file.id,
        offset: 0,
        size: 6,
        data: Buffer.from("sample").toString("base64"),
      },
    },
  ]);
});
