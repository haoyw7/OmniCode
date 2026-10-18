import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Explicit development smoke: isolated config/resources, no model prompts.
const args = process.argv.slice(2);
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const binary = option("--binary") || process.env.MONOCODE_PI_BINARY || "pi";
const expectedVersion = option("--expected-version") || "1.0.1";
const version = execFileSync(binary, ["--version"], {
  encoding: "utf8",
}).trim();
assert.equal(
  version,
  expectedVersion,
  "This smoke validates the explicitly selected Pi version",
);
const directory = await mkdtemp(join(tmpdir(), "monocode-real-pi-"));
let child;
const pending = new Map();
let serial = 0;
let stderr = "";
let agentRuns = 0;
const dialogs = new Map();
const notices = [];
try {
  const extension = join(directory, "audit.mjs");
  await writeFile(
    extension,
    `export default function(pi) {
    pi.registerCommand("audit-handled", {description:"No model work", handler:async()=>{}});
    for (const method of ["select","confirm","input","editor"]) {
      pi.registerCommand("audit-"+method, {description:"RPC audit", handler:async(_args,ctx)=>{
        const value = method === "select" ? await ctx.ui.select("Pick", ["First","Second"])
          : method === "confirm" ? await ctx.ui.confirm("Confirm", "Continue?")
          : method === "input" ? await ctx.ui.input("Input", "Placeholder")
          : await ctx.ui.editor("Edit", "  first\\nsecond  ");
        ctx.ui.notify(JSON.stringify({method,value}), "info");
      }});
    }
  }`,
  );
  const skill = join(directory, "skill", "SKILL.md");
  await mkdir(join(directory, "skill"));
  await writeFile(
    skill,
    "---\nname: audit\ndescription: Local discovery audit\n---\nLocal test resource.\n",
  );
  const template = join(directory, "audit-template.md");
  await writeFile(
    template,
    "---\ndescription: Local template audit\n---\nLocal test template.\n",
  );
  const bundle = join(directory, "mapper.mjs");
  await build({
    stdin: {
      contents:
        'export * from "./src/integrations/harness/providers/pi/piProtocol.ts"; export * from "./src/integrations/harness/providers/pi/piSkills.ts";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    outfile: bundle,
    platform: "node",
    format: "esm",
    bundle: true,
    logLevel: "silent",
  });
  const mapper = await import(pathToFileURL(bundle).href);
  child = spawn(
    binary,
    [
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-tools",
      "--no-context-files",
      "--offline",
      "--extension",
      extension,
      "--skill",
      skill,
      "--prompt-template",
      template,
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: join(directory, "agent"),
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const send = (record) => child.stdin.write(JSON.stringify(record) + "\n");
  let buffer = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-4000);
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) => {
    buffer += data;
    for (let index; (index = buffer.indexOf("\n")) >= 0;) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record.type === "agent_start") agentRuns++;
      if (record.type === "response") {
        const request = pending.get(record.id);
        if (request) {
          pending.delete(record.id);
          clearTimeout(request.timer);
          record.success
            ? request.resolve(record)
            : request.reject(new Error(record.error));
        }
      } else if (record.type === "extension_ui_request") {
        const parsed = mapper.parseExtensionUiRequest(record);
        if (parsed?.method === "notify") {
          try {
            notices.push(JSON.parse(record.message));
          } catch {
            /* Other startup notifications. */
          }
        } else if (
          parsed &&
          ["select", "confirm", "input", "editor"].includes(parsed.method)
        ) {
          dialogs.set(parsed.method, parsed);
          send({
            type: "extension_ui_response",
            id: parsed.id,
            ...(parsed.method === "confirm"
              ? { confirmed: false }
              : {
                  value:
                    parsed.method === "select"
                      ? parsed.options[1]
                      : parsed.method === "input"
                        ? ""
                        : "  edited\ntext  ",
                }),
          });
        }
      }
    }
  });
  const request = (type, extra = {}) =>
    new Promise((resolve, reject) => {
      const id = `audit_${++serial}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Pi ${type} timed out: ${stderr}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      send({ id, type, ...extra });
    });
  await request("get_state");
  const commands = mapper.piCommandsFromRpcData(
    (await request("get_commands")).data,
  );
  assert(
    commands.some(
      (command) =>
        command.origin === "extension" && command.name === "audit-handled",
    ),
  );
  assert(
    commands.some(
      (command) =>
        command.origin === "prompt" && command.name === "audit-template",
    ),
  );
  assert(
    commands.some(
      (command) => command.origin === "skill" && command.name === "audit",
    ),
  );
  assert(
    Array.isArray((await request("get_available_thinking_levels")).data.levels),
  );
  for (const method of ["handled", "select", "confirm", "input", "editor"]) {
    const response = await request("prompt", { message: `/audit-${method}` });
    assert.equal(response.data.disposition, "handled");
  }
  assert.equal(dialogs.get("input").placeholder, "Placeholder");
  assert.equal(dialogs.get("editor").prefill, "  first\nsecond  ");
  for (const [method, value] of [
    ["select", "Second"],
    ["confirm", false],
    ["input", ""],
    ["editor", "  edited\ntext  "],
  ])
    assert(
      notices.some(
        (notice) => notice.method === method && notice.value === value,
      ),
    );
  assert.equal(agentRuns, 0, "Audit commands must not start model work");
  console.log(
    JSON.stringify({
      version,
      agentRuns,
      commands: "extension/prompt/skill passed",
      handled: "passed",
      dialogs: "select/confirm/empty input/multiline editor passed",
      thinkingQuery: "passed",
      modelCalls: 0,
    }),
  );
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  if (child) {
    child.stdin.end();
    await new Promise((resolve) => {
      if (child.exitCode != null) return resolve();
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await rm(directory, { recursive: true, force: true });
}
