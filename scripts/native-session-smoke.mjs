// Read/resume protocol smoke only: no paid model calls or writes to user history.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

function client(binary, args, cwd, env) {
  const child = spawn(binary, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let sequence = 0;
  let errorOutput = "";
  child.stderr.on("data", (chunk) => {
    errorOutput = (errorOutput + chunk.toString()).slice(-8000);
  });
  child.on("error", (error) => {
    for (const entry of pending.values()) entry.reject(error);
  });
  child.on("exit", (code) => {
    for (const entry of pending.values())
      entry.reject(new Error(`${binary} exited ${code}: ${errorOutput}`));
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(value.id);
    if (!entry) return;
    pending.delete(value.id);
    if (value.error || value.success === false)
      entry.reject(new Error(JSON.stringify(value.error ?? value)));
    else entry.resolve(value);
  });
  const request = (body) =>
    new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(`Timeout: ${body.method ?? body.type}: ${errorOutput}`),
        );
      }, 20000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ id, ...body }) + "\n");
    });
  return {
    request,
    notify: (body) => child.stdin.write(JSON.stringify(body) + "\n"),
    stop: () => {
      lines.close();
      child.kill();
    },
  };
}

const root = await mkdtemp(join(tmpdir(), "monocode-native-smoke-"));
const timestamp = new Date().toISOString();
const serialize = (records) =>
  records.map((row) => JSON.stringify(row)).join("\n") + "\n";
const clients = [];
try {
  const piId = randomUUID();
  const piFile = join(root, "pi.jsonl");
  await writeFile(
    piFile,
    serialize([
      { type: "session", version: 3, id: piId, cwd: root, timestamp },
      {
        type: "message",
        id: "u",
        parentId: null,
        timestamp,
        message: {
          role: "user",
          content: "native smoke user",
          timestamp: Date.now(),
        },
      },
      {
        type: "message",
        id: "a",
        parentId: "u",
        timestamp,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "native smoke answer" }],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5.4",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
    ]),
  );
  const pi = client(
    "pi",
    [
      "--mode",
      "rpc",
      "--session",
      piFile,
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
    ],
    root,
    {
      PI_CODING_AGENT_DIR: join(root, "pi-config"),
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    },
  );
  clients.push(pi);
  const state = await pi.request({ type: "get_state" });
  assert.equal(state.data.sessionId, piId);
  const messages = await pi.request({ type: "get_messages" });
  assert.equal(messages.data.messages[0].content, "native smoke user");
  assert.equal(
    messages.data.messages[1].content[0].text,
    "native smoke answer",
  );
  console.log(
    `Pi ${execFileSync("pi", ["--version"], { encoding: "utf8" }).trim()}: exact-file resume and get_messages passed`,
  );

  const codexId = randomUUID();
  const codexHome = join(root, "codex-home");
  const day = timestamp.slice(0, 10).split("-");
  const rolloutDir = join(codexHome, "sessions", ...day);
  await mkdir(rolloutDir, { recursive: true });
  const rollout = join(
    rolloutDir,
    `rollout-${timestamp.replaceAll(":", "-")}-${codexId}.jsonl`,
  );
  await writeFile(
    rollout,
    serialize([
      {
        timestamp,
        type: "session_meta",
        payload: {
          id: codexId,
          timestamp,
          cwd: root,
          originator: "codex_cli_rs",
          cli_version: "0.160.0",
          source: "cli",
          model_provider: "openai",
        },
      },
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "native smoke user" }],
        },
      },
      {
        timestamp,
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "native smoke user",
          images: [],
          local_images: [],
        },
      },
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "native smoke answer" }],
          phase: "final_answer",
        },
      },
      {
        timestamp,
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "native smoke answer",
          phase: "final_answer",
        },
      },
      {
        timestamp,
        type: "event_msg",
        payload: {
          type: "task_complete",
          last_agent_message: "native smoke answer",
        },
      },
    ]),
  );
  const codex = client("codex", ["app-server"], root, {
    CODEX_HOME: codexHome,
  });
  clients.push(codex);
  await codex.request({
    method: "initialize",
    params: {
      clientInfo: { name: "monocode_native_smoke", version: "0.1" },
      capabilities: { experimentalApi: true },
    },
  });
  codex.notify({ method: "initialized" });
  const resumed = await codex.request({
    method: "thread/resume",
    params: {
      threadId: codexId,
      cwd: root,
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    },
  });
  assert.equal(resumed.result.thread.id, codexId);
  const history = await codex.request({
    method: "thread/read",
    params: { threadId: codexId, includeTurns: true },
  });
  const text = JSON.stringify(history.result);
  assert.ok(text.includes("native smoke user"));
  assert.ok(text.includes("native smoke answer"));
  console.log(
    `Codex ${execFileSync("codex", ["--version"], { encoding: "utf8" }).trim()}: native-ID resume and thread/read passed`,
  );
} finally {
  for (const child of clients) child.stop();
  await rm(root, { recursive: true, force: true });
}
