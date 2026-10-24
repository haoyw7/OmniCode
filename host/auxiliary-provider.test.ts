import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { HostAuxiliaryProvider } from "./auxiliary-provider";
import type { runHostTextPrompt } from "./provider-text";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup(runText = vi.fn<typeof runHostTextPrompt>(async () => '{"subject":"Fix login","body":"Keep the existing flow"}')) {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-provider-aux-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Project");
  const workspace = { run: vi.fn(async () => ({ branch: "main", summary: "1 file", patch: "diff --git a/a b/a" })) };
  const accounts = vi.fn(() => undefined);
  const service = new HostAuxiliaryProvider(store, workspace, async () => ["codex"], runText, accounts);
  cleanups.push(() => { service.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = { requestId: "request", projectId: project.id, operation: "commit", harness: "codex", providerAccountId: "account" };
  return { service, store, request, workspace, runText, accounts, directory };
}

it("generates from Host Git context once and enforces owner-scoped idempotency", async () => {
  const { service, request, runText, workspace, accounts, directory } = setup();
  service.start("device", request);
  service.start("device", { ...request });
  const result = await service.read("device", request.requestId);
  expect(result).toMatchObject({ status: "completed", result: { operation: "commit", message: expect.stringContaining("Fix login") } });
  expect(runText).toHaveBeenCalledOnce();
  expect(workspace.run).toHaveBeenCalledWith("git_staged_context", { cwd: directory });
  expect(accounts).toHaveBeenCalledWith(expect.any(String), "codex", "account");
  expect(() => service.start("device", { ...request, message: "different" })).toThrow("different content");
  await expect(service.read("other-device", request.requestId)).rejects.toThrow("unavailable");
});

it("retains a cancellation before a delayed start and stops an active request", async () => {
  const run = vi.fn<typeof runHostTextPrompt>(input => new Promise((_, reject) => {
    input.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }));
  const { service, request } = setup(run);
  service.cancel("early", request.requestId);
  expect(service.start("early", request)).toEqual({ status: "cancelled" });
  expect(run).not.toHaveBeenCalled();
  service.start("active", request);
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  expect(service.cancel("active", request.requestId)).toEqual({ status: "cancelled" });
  expect(await service.read("active", request.requestId)).toEqual({ status: "cancelled" });
});

it("rejects unregistered projects before starting a provider", async () => {
  const { service, request, runText } = setup();
  service.start("device", { ...request, projectId: "unknown" });
  expect(await service.read("device", request.requestId)).toMatchObject({ status: "failed", error: expect.stringContaining("not registered") });
  expect(runText).not.toHaveBeenCalled();
});

it("falls back to an installed text provider without carrying a different provider's account", async () => {
  const { service, request, runText, accounts } = setup();
  service.start("device", { ...request, harness: "claude" });
  await service.read("device", request.requestId);
  expect(runText).toHaveBeenCalledWith(expect.objectContaining({ harness: "codex" }));
  expect(accounts).toHaveBeenCalledWith(expect.any(String), "codex", undefined);
});
