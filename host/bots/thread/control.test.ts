import { connect } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostControl } from "../../control";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostResourceGuard } from "../resources";
import { checkoutPath } from "../../checkout-guards";
import { executeBotAction } from "./control";
import type { HostProvider } from "../../providers";

const resourceCleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of resourceCleanups.splice(0)) await cleanup(); });
async function resourceFixture() {
  const directory = mkdtempSync(join(tmpdir(), "assistant-control-resources-"));
  const cwd = join(directory, "project"); mkdirSync(cwd);
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(cwd, "Project");
  const turns: Array<() => void> = [];
  const provider: HostProvider = { send: vi.fn(() => new Promise<void>((resolve) => turns.push(resolve))),
    stop: vi.fn(async () => { turns.forEach((resolve) => resolve()); }), cancel: vi.fn(async () => { turns.forEach((resolve) => resolve()); }), bind: vi.fn() };
  const engine = new HostEngine(store, { codex: provider });
  const guard = new HostResourceGuard(store);
  resourceCleanups.push(async () => { guard.close(); await engine.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  await engine.ready;
  engine.assistant.setCatalog(async () => ["codex"], async () => ({ models: { codex: [{ id: "test", name: "Test" }] }, errors: {} }));
  await engine.assistant.rpc("assistant.configure", { commandId: "setup", expectedRevision: 0,
    patch: { harness: "codex", model: "test", triggers: { user: true, event: false, schedule: false } } });
  await engine.assistant.rpc("assistant.send", { commandId: "start", text: "Check the workspace" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const path = join(cwd, "note.txt"); writeFileSync(path, "before");
  return { engine, store, project, path, cwd, guard };
}

async function call(
  environment: Record<string, string>,
  namespace = "assistant",
) {
  return new Promise<any>((resolve, reject) => {
    const socket = connect(
      Number(environment.MONOCODE_CONTROL_ENDPOINT.split(":")[1]),
      "127.0.0.1",
    );
    let reply = "";
    socket.on("error", reject);
    socket.setEncoding("utf8");
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({
          namespace,
          token: environment.MONOCODE_CONTROL_TOKEN,
          requestId: "stable",
          action: "projects.list",
          input: {},
        }) + "\n",
      ),
    );
    socket.on("data", (data) => (reply += data));
    socket.on("end", () => resolve(JSON.parse(reply)));
  });
}
it("isolates assistant grants from orchestration and from an older brain generation", async () => {
  const handle = vi.fn(async () => ({ projects: [] }));
  const assistant = new HostControl(handle, {
    namespace: "assistant",
    actions: ["projects.list"],
  });
  const orchestration = new HostControl(async () => ({}));
  await Promise.all([assistant.ready, orchestration.ready]);
  try {
    assistant.enable("brain");
    orchestration.enable("lead");
    const first = assistant.environment("brain");
    expect(await call(first)).toMatchObject({ ok: true });
    expect(await call(first, "control")).toMatchObject({ ok: false });
    expect(
      await call({
        ...first,
        MONOCODE_CONTROL_TOKEN:
          orchestration.environment("lead").MONOCODE_CONTROL_TOKEN,
      }),
    ).toMatchObject({ ok: false });
    assistant.enable("brain");
    expect(await call(first)).toMatchObject({ ok: false });
    expect(await call(assistant.environment("brain"))).toMatchObject({
      ok: true,
    });
    expect(handle).toHaveBeenCalledTimes(2);
  } finally {
    await assistant.close();
    await orchestration.close();
  }
});
it("suppresses a read result when its grant is revoked during an await", async () => {
  let finish!: () => void;
  const started = vi.fn();
  const assistant = new HostControl(
    async () => {
      started();
      await new Promise<void>((resolve) => (finish = resolve));
      return { secretResult: true };
    },
    { namespace: "assistant", actions: ["projects.list"] },
  );
  await assistant.ready;
  try {
    assistant.enable("brain");
    const request = call(assistant.environment("brain"));
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    assistant.disable("brain");
    finish();
    expect(await request).toMatchObject({ ok: false });
  } finally {
    await assistant.close();
  }
});

it("allows control reads but refuses writes and Git changes during exclusive integration", async () => {
  const f = await resourceFixture();
  f.store.db.prepare("INSERT INTO checkout_resources VALUES (?, ?, ?, ?)").run("integration", checkoutPath(f.cwd), "integrating", process.pid);
  expect(await executeBotAction(f.engine.assistant, "read-busy", "files.read", {
    projectId: f.project.id, args: { path: f.path },
  }, () => true)).toBe("before");
  const input = { projectId: f.project.id, args: { path: f.path, content: "after" } };
  await expect(executeBotAction(f.engine.assistant, "write-busy", "files.write", input, () => true)).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
  expect(f.engine.assistant.store.action("write-busy")?.state).toBe("failed");
  await expect(executeBotAction(f.engine.assistant, "git-busy", "git.action", {
    projectId: f.project.id, command: "git_stage_all", args: { cwd: f.cwd },
  }, () => true)).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
  expect(readFileSync(f.path, "utf8")).toBe("before");
  f.store.db.prepare("DELETE FROM checkout_resources WHERE id=?").run("integration");
  // Refusal had no side effect, so the stable request can be retried safely.
  await executeBotAction(f.engine.assistant, "write-busy", "files.write", input, () => true);
  expect(readFileSync(f.path, "utf8")).toBe("after");
});

it("allows Bot file writes during shared execution without releasing the outer reservation", async () => {
  const f = await resourceFixture();
  const runId = f.engine.assistant.currentRun!.id;
  expect(f.guard.acquire(runId, { workingDirectory: f.cwd }).acquired).toBe(true);
  const idle = vi.spyOn(f.engine, "withIdleProject");
  await executeBotAction(f.engine.assistant, "own-write", "files.write", {
    projectId: f.project.id, args: { path: f.path, content: "same run" },
  }, () => true);
  expect(readFileSync(f.path, "utf8")).toBe("same run");
  expect(idle).not.toHaveBeenCalled();
  const outsider = new HostResourceGuard(f.store);
  expect(outsider.acquire("foreign", { workingDirectory: f.cwd }).acquired).toBe(true);
  f.guard.release(runId);
  expect(outsider.acquire("foreign", { workingDirectory: f.cwd }).acquired).toBe(true);
  outsider.close();
});
