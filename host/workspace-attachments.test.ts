import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";
import type { BinaryTransfer, BinaryTransferChunk } from "../src/contracts/hostMedia";

it("inspects only project attachments and reads a bounded immutable snapshot in RPC-safe chunks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-attachments-"));
  const root = join(directory, "project");
  mkdirSync(root);
  const store = new HostStore(join(directory, "host.db"));
  try {
    store.addProject(root, "project");
    const workspace = new WorkspaceCommands(store, async (_id, action) => action());
    const file = join(root, "large.png");
    const bytes = Buffer.alloc(13 * 1024 * 1024 + 1, 37);
    writeFileSync(file, bytes);
    expect(await workspace.run("inspect_paths", { paths: [file] })).toEqual([
      expect.objectContaining({ name: "large.png", size: bytes.length, isDir: false }),
    ]);
    const transfer = await workspace.run("read_file_base64", { path: file }) as BinaryTransfer;
    writeFileSync(file, "changed after capture");
    const pieces: Buffer[] = [];
    let offset = 0;
    while (offset < transfer.size) {
      const chunk = await workspace.run("read_attachment_chunk", { path: file, transfer: transfer.transfer, offset }) as BinaryTransferChunk;
      expect(JSON.stringify(chunk).length).toBeLessThan(1024 * 1024);
      pieces.push(Buffer.from(chunk.data, "base64"));
      offset = chunk.offset;
    }
    expect(Buffer.concat(pieces).equals(bytes)).toBe(true);
    const outside = join(directory, "private.png");
    writeFileSync(outside, "private");
    await expect(workspace.run("inspect_paths", { paths: [outside] })).rejects.toThrow();
    await expect(workspace.run("read_file_base64", { path: outside })).rejects.toThrow();
    await expect(workspace.run("read_attachment_chunk", { path: outside, transfer: transfer.transfer, offset: 0 })).rejects.toThrow();
    writeFileSync(file, Buffer.alloc(20 * 1024 * 1024 + 1));
    await expect(workspace.run("read_file_base64", { path: file })).rejects.toThrow("too large");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
