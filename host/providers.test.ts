import { expect, it, vi } from "vitest";
import {
  REMOTE_PROVIDERS,
  isRemoteProvider,
  requireHostDescriptor,
} from "../src/features/connections/model/protocol";
import { hostProviders } from "./providers";
import { HARNESSES } from "../src/features/sessions/model/session";
import { runPiTextPrompt, runOmpTextPrompt } from "../src/integrations/harness/providers/pi/piText";

vi.mock("../src/integrations/harness/providers/pi/piText", () => ({
  runPiTextPrompt: vi.fn(async () => '{"branch":"pi-worktree-name"}'),
  runOmpTextPrompt: vi.fn(async () => '{"branch":"omp-worktree-name"}'),
}));

it.each(["pi", "omp"] as const)("uses the %s text model for Host worktree naming", async (id) => {
  expect(await hostProviders[id].generateBranchName!("/repo", "为工作树命名")).toBe(`${id}-worktree-name`);
  expect(id === "pi" ? runPiTextPrompt : runOmpTextPrompt).toHaveBeenCalledWith(expect.objectContaining({
    cwd: "/repo", prompt: expect.stringContaining("为工作树命名"),
  }));
});

it("exposes every local harness through the remote host contract", () => {
  expect(Object.keys(hostProviders).sort()).toEqual(
    [...REMOTE_PROVIDERS].sort(),
  );
  expect([...REMOTE_PROVIDERS].sort()).toEqual([...HARNESSES].sort());
  for (const provider of REMOTE_PROVIDERS) {
    expect(isRemoteProvider(provider)).toBe(true);
    expect(hostProviders[provider].send).toBeTypeOf("function");
    expect(hostProviders[provider].cancel).toBeTypeOf("function");
    expect(hostProviders[provider].bind).toBeTypeOf("function");
    expect(hostProviders[provider].approve).toBeTypeOf("function");
  }
  expect(
    requireHostDescriptor({
      protocolVersion: 1,
      environmentId: "host",
      name: "fixture",
      providers: [...REMOTE_PROVIDERS],
      capabilities: [],
    }).providers,
  ).toHaveLength(REMOTE_PROVIDERS.length);
});

it("advertises steering only for adapters with a working native interface", () => {
  for (const id of ["codex", "claude", "cursor", "opencode", "pi", "omp", "hermes"] as const)
    expect(hostProviders[id].steer).toBeTypeOf("function");
  for (const id of ["grok", "fx", "antigravity"] as const) expect(hostProviders[id].steer).toBeUndefined();
});
