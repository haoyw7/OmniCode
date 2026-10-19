import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDeepseekBridge } from "./deepseek-bridge";
import { providerLaunch } from "./process";

// Opt in with an installed DSH CLI. All inference uses the local fixture adapter.
const binary = process.env.OMNICODE_TEST_DSH;
describe.skipIf(!binary)("DeepSeek real runtime bridge", () => {
  let root: string;
  let cwd: string;
  let child: ChildProcessWithoutNullStreams;
  let exit: Promise<number | null>;
  let sessionId: string;
  let next = 1;
  let stderr = "";
  let approval = "allow";
  let questionMode: "answer" | "wait" = "answer";
  let notifications: any[] = [];
  let requests: any[] = [];
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const watchers = new Set<{
    predicate: (value: any) => boolean;
    resolve: (value: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const send = (frame: object) =>
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  const request = (method: string, params: object = {}): Promise<any> => {
    const id = next++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(new Error(`${method} timed out\n${stderr}`));
        },
        method === "initialize" ? 60_000 : 25_000,
      );
      pending.set(id, { resolve, reject, timer });
    });
    send({ jsonrpc: "2.0", id, method, params });
    return result;
  };
  const receive = (predicate: (value: any) => boolean) => {
    const found = notifications.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise<any>((resolve, reject) => {
      const watcher = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          watchers.delete(watcher);
          reject(new Error(`Bridge event timed out\n${stderr}`));
        }, 15_000),
      };
      watchers.add(watcher);
    });
  };
  const completed = (runId: string) =>
    receive(
      (frame) =>
        frame.params?.kind === "run.completed" &&
        frame.params.data.runId === runId,
    );
  const prompt = (text: string) =>
    request("session/prompt", { sessionId, content: [{ type: "text", text }] });

  async function start() {
    const launch = await prepareDeepseekBridge(binary!, cwd);
    const profile = join(root, "home", "profiles", "omnicode-v1");
    const fixture = join(profile, "fixture.mjs");
    await writeFile(
      fixture,
      await readFile(
        new URL(
          "../src/integrations/harness/providers/deepseek/bridge/fixture.test.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const patchPath = join(profile, "fixture.patch.yml");
    await writeFile(
      patchPath,
      JSON.stringify([{ insert: [{ id: "omnicode-fixture", name: fixture }] }]),
    );
    const target = await providerLaunch(launch.path, [
      ...launch.args,
      "--patch",
      patchPath,
    ]);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/(API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key),
      ),
    );
    child = spawn(target.command, target.args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    exit = new Promise((resolve) => child.once("exit", resolve));
    child.stderr.on("data", (bytes) => {
      stderr = (stderr + bytes.toString()).slice(-8000);
    });
    child.stdin.on("error", () => {});
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const frame = JSON.parse(line);
      if (frame.method && frame.id !== undefined) {
        requests.push(frame);
        if (frame.method === "approval/request" || questionMode === "answer")
          send({
            jsonrpc: "2.0",
            id: frame.id,
            result:
              frame.method === "approval/request"
                ? { decision: approval }
                : {
                    answers: Object.fromEntries(
                      frame.params.questions.map((question: any) => [
                        question.id,
                        [question.options[0].label],
                      ]),
                    ),
                    custom: {},
                  },
          });
      } else if (frame.method) {
        notifications.push(frame);
        for (const watcher of watchers)
          if (watcher.predicate(frame)) {
            clearTimeout(watcher.timer);
            watchers.delete(watcher);
            watcher.resolve(frame);
          }
      } else {
        const waiter = pending.get(frame.id);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        pending.delete(frame.id);
        if (frame.error) waiter.reject(new Error(frame.error.message));
        else waiter.resolve(frame.result);
      }
    });
    child.once("exit", (code) => {
      lines.close();
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`DSH exited ${code}\n${stderr}`));
      }
      pending.clear();
    });
    return request("initialize", { protocolVersion: 1 });
  }
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "omnicode-dsh-live-"));
    cwd = join(root, "工作区 with spaces");
    await mkdir(cwd);
    vi.stubEnv("DSH_HOME", join(root, "home"));
    const initialized = await start();
    expect(initialized.runtimeVersion).toBe("0.2.1-rc.2");
    expect(
      initialized.catalog.some(
        (provider: any) => provider.id === "omnicode-fixture",
      ),
    ).toBe(true);
    const created = await request("session/new", {
      cwd,
      selection: { provider: "omnicode-fixture", model: "fixture" },
      runtimeMode: "supervised",
    });
    sessionId = created.sessionId;
    expect(created.image).toBe(true);
  }, 90_000);
  afterAll(async () => {
    if (child) {
      if (child.exitCode === null) {
        await request("shutdown").catch(() => {});
        child.stdin.end();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          exit,
          new Promise((resolve) => {
            timer = setTimeout(() => {
              child.kill();
              resolve(null);
            }, 12_000);
          }),
        ]);
        clearTimeout(timer);
      }
      await exit;
    }
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    for (const watcher of watchers) clearTimeout(watcher.timer);
    vi.unstubAllEnvs();
    if (root) await rm(root, { recursive: true, force: true });
  }, 45_000);

  it("streams before completion and accepts subsequent turns", async () => {
    const offset = notifications.length;
    const receipt = await prompt("fixture:plain");
    const end = await completed(receipt.runId);
    expect(end.params.data.error).toBeUndefined();
    const chunks = notifications
      .slice(offset)
      .filter(
        (frame) =>
          frame.params.kind === "assistant.stream" &&
          frame.params.data.type === "chunk",
      );
    expect(
      chunks.some((frame) => frame.params.data.chunk.type === "text-delta"),
    ).toBe(true);
    expect(notifications.indexOf(chunks[0])).toBeLessThan(
      notifications.indexOf(end),
    );
    const followup = await prompt("fixture:again");
    await completed(followup.runId);
  });

  it("round-trips approval and structured questions", async () => {
    const write = await prompt("fixture:write");
    expect((await completed(write.runId)).params.data.error).toBeUndefined();
    expect(
      requests.some(
        (frame) =>
          frame.method === "approval/request" &&
          frame.params.toolName === "write",
      ),
    ).toBe(true);
    expect(await readFile(join(cwd, "fixture-result.txt"), "utf8")).toBe(
      "fixture result",
    );
    const question = await prompt("fixture:question");
    await completed(question.runId);
    const asked = requests.find((frame) => frame.method === "question/request");
    expect(
      asked,
      JSON.stringify(
        notifications.filter(
          (frame) =>
            frame.params.kind === "durable" &&
            frame.params.data.type === "tool/result",
        ),
      ),
    ).toBeDefined();
    expect(asked.params.questions[0]).toMatchObject({
      question: "Choose a fixture",
      options: [{ label: "One" }, { label: "Two" }],
    });
  });

  it("cancels a running stream and leaves the session usable", async () => {
    const receipt = await prompt("fixture:slow");
    await receive(
      (frame) =>
        frame.params.runId === receipt.runId &&
        frame.params.kind === "assistant.stream" &&
        frame.params.data.chunk?.type === "text-delta",
    );
    await request("session/cancel", { sessionId });
    expect((await completed(receipt.runId)).params.data.cancelled).toBe(true);
    const next = await prompt("fixture:after-cancel");
    expect((await completed(next.runId)).params.data.error).toBeUndefined();
  });

  it("reports a failed model request instead of successful completion", async () => {
    const failure = await prompt("fixture:error");
    expect((await completed(failure.runId)).params.data.error).toContain(
      "Fixture authentication failure",
    );
    const next = await prompt("fixture:recovered");
    expect((await completed(next.runId)).params.data.error).toBeUndefined();
  });

  it("honors denied approvals and switches permission modes explicitly", async () => {
    const before = requests.length;
    approval = "deny";
    const denied = await prompt("fixture:write denied file=denied.txt");
    await completed(denied.runId);
    await expect(readFile(join(cwd, "denied.txt"))).rejects.toThrow();
    expect(
      requests
        .slice(before)
        .some((frame) => frame.method === "approval/request"),
    ).toBe(true);
    for (const runtimeMode of ["auto-accept-edits", "auto", "full-access"]) {
      const count = requests.length;
      await request("session/configure", { sessionId, runtimeMode });
      const allowed = await prompt(
        `fixture:write ${runtimeMode} file=${runtimeMode}.txt`,
      );
      expect(
        (await completed(allowed.runId)).params.data.error,
      ).toBeUndefined();
      const results = notifications.filter(
        (frame) =>
          frame.params.runId === allowed.runId &&
          frame.params.data.type === "tool/result",
      );
      expect(
        results.every((frame) => !frame.params.data.data.message.isError),
        `${runtimeMode}: ${JSON.stringify(results)}`,
      ).toBe(true);
      expect(await readFile(join(cwd, `${runtimeMode}.txt`), "utf8")).toBe(
        "fixture result",
      );
      expect(
        requests
          .slice(count)
          .filter((frame) => frame.method === "approval/request"),
      ).toEqual([]);
    }
    approval = "allow";
    await request("session/configure", {
      sessionId,
      runtimeMode: "supervised",
    });
  });

  it("reviews the complete plan and projects native todos", async () => {
    await request("session/configure", { sessionId, planning: true });
    const before = requests.length;
    const plan = await prompt("fixture:plan");
    await completed(plan.runId);
    const review = requests
      .slice(before)
      .find((frame) => frame.method === "question/request");
    expect(review.params.questions[0]).toMatchObject({
      detail: "# Fixture plan\n\n1. Inspect\n2. Implement\n3. Verify",
      intent: { kind: "plan-review", approve: "Approve" },
    });
    await request("session/configure", { sessionId, planning: false });
    const todo = await prompt("fixture:todos");
    await completed(todo.runId);
    expect(
      notifications.some(
        (frame) =>
          frame.params.data.type === "todo/write" &&
          frame.params.data.data.todos[0].content === "Fixture task",
      ),
    ).toBe(true);
  });

  it("times out unattended questions and accepts a structured late answer", async () => {
    questionMode = "wait";
    const before = requests.length;
    const question = await prompt("fixture:question timeout");
    await completed(question.runId);
    const asked = requests
      .slice(before)
      .find((frame) => frame.method === "question/request");
    expect(asked.params.allowLateReply).toBe(true);
    const answered = await request("question/answer", {
      sessionId,
      callId: asked.params.callId,
      answer: { answers: { choice: ["Two"] }, custom: {} },
    });
    expect((await completed(answered.runId)).params.data.error).toBeUndefined();
    expect(
      notifications.some(
        (frame) =>
          frame.params.runId === answered.runId &&
          frame.params.data.chunk?.text?.includes("late answer received"),
      ),
    ).toBe(true);
    await expect(
      request("question/answer", {
        sessionId,
        callId: asked.params.callId,
        answer: { answers: { choice: ["One"] } },
      }),
    ).rejects.toThrow("no longer answerable");
    questionMode = "answer";
  });

  it("holds the question when the user interacts and cancels pending interactions", async () => {
    questionMode = "wait";
    const before = requests.length;
    const question = await prompt("fixture:question timeout held");
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(before));
    const asked = requests.at(-1);
    expect(
      await request("question/claim", {
        sessionId,
        callId: asked.params.callId,
      }),
    ).toEqual({ claimed: true });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(
      notifications.some(
        (frame) =>
          frame.params.kind === "run.completed" &&
          frame.params.data.runId === question.runId,
      ),
    ).toBe(false);
    await request("session/cancel", { sessionId });
    expect((await completed(question.runId)).params.data.cancelled).toBe(true);
    questionMode = "answer";
  });

  it("admits images, returns image bytes and rejects a text-only route", async () => {
    const data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC";
    await writeFile(join(cwd, "fixture.png"), Buffer.from(data, "base64"));
    const receipt = await request("session/prompt", {
      sessionId,
      content: [
        {
          type: "image",
          mimeType: "image/png",
          path: join(cwd, "fixture.png"),
        },
      ],
    });
    expect((await completed(receipt.runId)).params.data.error).toBeUndefined();
    expect(
      notifications.some(
        (frame) =>
          frame.params.runId === receipt.runId &&
          frame.params.data.chunk?.text?.includes("received"),
      ),
    ).toBe(true);
    const output = await prompt("fixture:image-output");
    await completed(output.runId);
    expect(
      notifications.find((frame) => frame.params.kind === "image")?.params.data,
    ).toMatchObject({ data, mimeType: "image/png" });
    await request("session/configure", {
      sessionId,
      selection: { provider: "omnicode-fixture", model: "text-only" },
    });
    await expect(
      request("session/prompt", {
        sessionId,
        content: [{ type: "image", mimeType: "image/png", data }],
      }),
    ).rejects.toThrow("does not accept images");
    await request("session/configure", {
      sessionId,
      selection: { provider: "omnicode-fixture", model: "fixture" },
    });
  });

  it("supports steering and restores the same session in a second process", async () => {
    const receipt = await prompt("fixture:slow");
    await request("session/steer", {
      sessionId,
      content: [{ type: "text", text: "fixture:steered" }],
    });
    expect((await completed(receipt.runId)).params.data.error).toBeUndefined();
    questionMode = "wait";
    const missed = await prompt("fixture:question timeout before-restart");
    await completed(missed.runId);
    const savedQuestion = requests.findLast(
      (frame) => frame.method === "question/request",
    ).params.callId;
    await request("session/close", { sessionId });
    child.stdin.end();
    expect(await exit).toBe(0);
    notifications = [];
    requests = [];
    approval = "deny";
    await start();
    const restored = await request("session/resume", {
      sessionId,
      cwd,
      selection: { provider: "omnicode-fixture", model: "fixture" },
      runtimeMode: "supervised",
    });
    expect(restored.sessionId).toBe(sessionId);
    const late = await request("question/answer", {
      sessionId,
      callId: savedQuestion,
      answer: { answers: { choice: ["Two"] }, custom: {} },
    });
    expect(late.accepted).toBe(true);
    expect((await completed(late.runId)).params.data.error).toBeUndefined();
    questionMode = "answer";
    const resumed = await prompt("fixture:resumed");
    expect((await completed(resumed.runId)).params.data.error).toBeUndefined();
  });

  it("waits for native child agents and forwards their live timeline", async () => {
    await request("session/configure", {
      sessionId,
      runtimeMode: "full-access",
    });
    const child = await prompt("fixture:delegate");
    expect((await completed(child.runId)).params.data.error).toBeUndefined();
    const childEvents = notifications.filter(
      (frame) =>
        frame.params.runId === child.runId &&
        frame.params.sourceSessionId !== sessionId,
    );
    expect(
      childEvents.some((frame) => frame.params.kind === "agent.started"),
      JSON.stringify(
        notifications.filter(
          (frame) =>
            frame.params.runId === child.runId &&
            frame.params.data.type === "tool/result",
        ),
      ),
    ).toBe(true);
    expect(
      childEvents.some(
        (frame) => frame.params.data.chunk?.type === "text-delta",
      ),
    ).toBe(true);
    expect(
      childEvents.some(
        (frame) =>
          frame.params.kind === "agent.status" &&
          frame.params.data.status === "idle",
      ),
    ).toBe(true);
  });

  it("waits for background jobs and cancels their owned work", async () => {
    await request("session/configure", {
      sessionId,
      runtimeMode: "full-access",
    });
    const job = await prompt("fixture:job");
    const end = await completed(job.runId);
    expect(end.params.data.error).toBeUndefined();
    const jobFrames = notifications.filter(
      (frame) =>
        frame.params.runId === job.runId && frame.params.kind === "jobs",
    );
    expect(
      jobFrames.some(
        (frame) =>
          frame.params.data.jobs[0]?.label === "Fixture background job",
      ),
    ).toBe(true);
    expect(jobFrames.at(-1).params.data.jobs).toEqual([]);
    expect(notifications.indexOf(jobFrames.at(-1))).toBeLessThan(
      notifications.indexOf(end),
    );
    const cancelled = await prompt("fixture:job cancel");
    await receive(
      (frame) =>
        frame.params.runId === cancelled.runId &&
        frame.params.kind === "jobs" &&
        frame.params.data.jobs.length > 0,
    );
    await request("session/cancel", { sessionId });
    expect((await completed(cancelled.runId)).params.data.cancelled).toBe(true);
  });
});
