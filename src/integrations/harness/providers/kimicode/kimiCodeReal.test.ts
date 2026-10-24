// Opt-in real CLI regression with a local scripted model; no account is used.
// KIMI_CODE_ENTRY=/path/to/@moonshot-ai/kimi-code/dist/main.mjs
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";

const runtime = vi.hoisted(() => ({
  children: new Map<
    string,
    import("node:child_process").ChildProcessWithoutNullStreams
  >(),
  lines: new Map<string, (line: string) => void>(),
  exits: new Map<string, (code: number | null) => void>(),
  home: "",
  methods: [] as string[],
  stderr: [] as string[],
}));
vi.mock("../../core/child", () => ({
  resolveKimiCodeBinary: async () => ({ path: process.env.KIMI_CODE_ENTRY! }),
  watchChild: (
    id: string,
    line: (line: string) => void,
    exit: (code: number | null) => void,
  ) => {
    runtime.lines.set(id, line);
    runtime.exits.set(id, exit);
  },
  unwatchChild: (id: string) => {
    runtime.lines.delete(id);
    runtime.exits.delete(id);
  },
  spawnChild: async (
    id: string,
    entry: string,
    args: string[],
    cwd: string,
  ) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, KIMI_CODE_HOME: runtime.home },
    });
    runtime.children.set(id, child);
    createInterface({ input: child.stdout }).on("line", (line) =>
      runtime.lines.get(id)?.(line),
    );
    createInterface({ input: child.stderr }).on("line", (line) =>
      runtime.stderr.push(line),
    );
    child.on("exit", (code) => {
      if (runtime.children.get(id) === child) runtime.exits.get(id)?.(code);
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  },
  writeChild: async (id: string, line: string) => {
    const child = runtime.children.get(id)!;
    const message = JSON.parse(line);
    if (message.method) runtime.methods.push(message.method);
    await new Promise<void>((resolve, reject) =>
      child.stdin.write(`${line}\n`, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  },
  killChild: async (id: string) => {
    const child = runtime.children.get(id);
    runtime.children.delete(id);
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    child.kill();
    await exited;
  },
}));
import {
  discoverKimiCodeModels,
  forgetKimiCodeSession,
  respondKimiCodeQuestion,
  sendKimiCodeTurn,
  stopKimiCodeSession,
} from "./kimiCode";

describe.skipIf(!process.env.KIMI_CODE_ENTRY)(
  "Kimi Code real CLI with a local model",
  () => {
    it("runs streamed turns, native questions, catalog discovery and a process restart/resume", async () => {
      const root = await mkdtemp(join(tmpdir(), "omnicode-kimi-real-"));
      runtime.home = join(root, "home");
      await mkdir(runtime.home);
      const cwd = join(root, "project");
      await mkdir(cwd);
      let ask = false;
      let edit = false;
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          tools?: { function: { name: string } }[];
        };
        const questionTool = body.tools?.find(
          (tool) => tool.function.name === "AskUserQuestion",
        );
        const writeTool = body.tools?.find(
          (tool) => tool.function.name === "Write",
        );
        response.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (delta: unknown, finishReason: string | null = null) =>
          response.write(
            `data: ${JSON.stringify({
              id: "local-test",
              object: "chat.completion.chunk",
              created: 1,
              model: "test-model",
              choices: [{ index: 0, delta, finish_reason: finishReason }],
            })}\n\n`,
          );
        if (edit && writeTool) {
          edit = false;
          emit({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "write-call",
                type: "function",
                function: {
                  name: writeTool.function.name,
                  arguments: JSON.stringify({
                    path: join(cwd, "verified.txt"),
                    content: "written by real Kimi",
                  }),
                },
              },
            ],
          });
          emit({}, "tool_calls");
        } else if (ask && questionTool) {
          ask = false;
          emit({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "question-call",
                type: "function",
                function: {
                  name: questionTool.function.name,
                  arguments: JSON.stringify({
                    questions: [
                      {
                        question: "Which platform?",
                        header: "Platform",
                        options: [
                          { label: "Windows", description: "Windows" },
                          { label: "Linux", description: "Linux" },
                        ],
                      },
                    ],
                  }),
                },
              },
            ],
          });
          emit({}, "tool_calls");
        } else {
          emit({ role: "assistant", content: "REAL_CLI_OK" });
          emit({}, "stop");
        }
        response.end("data: [DONE]\n\n");
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as { port: number }).port;
      await writeFile(
        join(runtime.home, "config.toml"),
        `default_model = "local/test"\ntelemetry = false\n[providers.local]\ntype = "openai"\nbase_url = "http://127.0.0.1:${port}/v1"\napi_key = "local-test-only"\n[models."local/test"]\nprovider = "local"\nmodel = "test-model"\nmax_context_size = 32000\ncapabilities = ["tool_use"]\n`,
      );
      const events: HarnessEvent[] = [];
      const send = (
        runtimeMode: "supervised" | "auto-accept-edits" = "supervised",
      ) =>
        sendKimiCodeTurn({
          sessionId: "kimi-real",
          cwd,
          model: "kimicode:local/test",
          text: "test",
          runtimeMode,
          onEvent: (event) => {
            events.push(event);
            if (event.type === "question.asked")
              respondKimiCodeQuestion("kimi-real", event.requestId, {
                kind: "answered",
                answers: { q0: ["Windows"] },
              });
          },
        });
      try {
        const models = await discoverKimiCodeModels(cwd);
        expect(models.some((model) => model.nativeId === "local/test")).toBe(
          true,
        );
        await send();
        expect(events).toContainEqual({
          type: "message.delta",
          text: "REAL_CLI_OK",
        });
        const bound = events.find(
          (event) => event.type === "session.providerBound",
        );
        expect(bound?.type).toBe("session.providerBound");
        ask = true;
        events.length = 0;
        await send();
        expect(events).toContainEqual(
          expect.objectContaining({ type: "question.asked" }),
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "question.resolved",
            decision: "answered",
          }),
        );
        edit = true;
        events.length = 0;
        await send("auto-accept-edits");
        expect(await readFile(join(cwd, "verified.txt"), "utf8")).toBe(
          "written by real Kimi",
        );
        expect(
          events.some((event) => event.type === "approval.requested"),
        ).toBe(false);
        await stopKimiCodeSession("kimi-real");
        events.length = 0;
        await send();
        expect(runtime.methods).toContain("session/resume");
        expect(
          events.find((event) => event.type === "session.providerBound"),
        ).toEqual(bound);
        expect(events).toContainEqual({ type: "message.completed" });
      } catch (error) {
        throw new Error(
          `${String(error)}\nEvents: ${JSON.stringify(events)}\n${runtime.stderr.join("\n")}`,
        );
      } finally {
        await forgetKimiCodeSession("kimi-real");
        for (const child of runtime.children.values())
          (child as ChildProcessWithoutNullStreams).kill();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
      }
    }, 90_000);
  },
);
