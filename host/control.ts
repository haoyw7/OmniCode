import { createServer, connect, type Server, type Socket } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { botErrorCode } from "./bots/thread/errors";
import { currentMachineIO } from "./machine-io";
import { wslControlLauncher } from "./wsl-control";

const ACTIONS = ["list", "delegate", "get", "message", "retry", "cancel", "wait", "review", "finish", "steer", "respond", "answer"];
export const CONTROL_HELP = `OmniCode Host control — supervise this orchestration run.
Usage: <control-cli> control ACTION [--json JSON | --input FILE|-] [--request-id ID]
Actions:
  list {} — inspect tasks, pending input and allowed models
  delegate {title,harness,model?,prompt,files,dependsOn?} — queue a bounded worker
  get {taskId} — inspect one task
  message {taskId,text} — send a stopped worker a turn in its current scope
  retry {taskId,text,files} — continue a stopped worker with corrected scopes
  cancel {taskId} — stop a worker
  wait {timeoutSeconds:20} — wait 0–25 seconds for a state change
  review {taskId} — inspect and integrate a completed worker
  finish {} — finish after every worker is reviewed or cancelled
  steer {taskId,text} — redirect a running worker
  respond {taskId,requestId,decision:"allow"|"deny"} — answer worker approval
  answer {taskId,requestId,answers:{questionId:[optionId]}} — answer a question; or {taskId,requestId,skip:true}
Unknown fields are rejected. Use exact harness/model IDs from list. Files are
project-relative scopes; directories cover descendants, and ["."] reserves
the checkout. Dependencies must be reviewed before dependent work runs.
Output is one JSON line; exit status 0 means ok:true. A failed or uncertain call
reports requestId: retry that exact request with --request-id, never a fresh ID.
When paused, inspect list/get/wait and ask the user to click Resume in desktop.
Host owns execution; exiting this CLI or closing desktop does not cancel work.
MONOCODE_CONTROL_ENDPOINT and MONOCODE_CONTROL_TOKEN are supplied only to the
lead process. Never print credentials.`;

export const WORKFLOW_ACTIONS = ["create", "amend", "resume", "cancel", "get", "list", "wait", "save", "saved", "snippet", "providers"];
export const WORKFLOW_HELP = `OmniCode dynamic workflows — run multi-agent workflow scripts from this conversation.
Usage: "$MONOCODE_WORKFLOW_CLI" workflow ACTION [--json JSON | --input FILE|-] [--request-id ID]
Actions:
  create {name?,script|saved{name,args?,scope?}|path,args?,maxConcurrency?,defaults?,agents?} — submit a run
  amend {runId,script?|path?,name?,maxConcurrency?,defaults?,agents?} — revise a run, reusing finished work
    Submitted runs wait (status awaiting_approval) until the user reviews the configuration
    on the run card and starts it; tell the user, then follow the run with wait.
  resume {runId} — continue a stopped run
  cancel {runId} — stop a running run
  get {runId} — snapshot a run
  list {} — runs launched from this conversation
  wait {runId,timeoutSeconds?:0-25} — wait for a change or settlement
  save {name,description,whenToUse?,scope,script|scriptPath,args?} — save a reusable workflow
  saved {} — list saved workflows
  snippet {code|path,args?,timeoutMs?} — run a world-read snippet synchronously
  providers {} — installed providers, models, thinking levels and speeds
defaults/agents entries are {provider?,model?,thinking?,speed?}. Read the authoring guide at
$MONOCODE_WORKFLOW_SKILL_DIR/SKILL.md before writing a script.
Output is one JSON line; exit status 0 means ok:true. Retry an uncertain call with the same
--request-id. Never print MONOCODE_WORKFLOW_TOKEN.`;

const NAMESPACE_ENV = {
  control: { endpoint: "MONOCODE_CONTROL_ENDPOINT", token: "MONOCODE_CONTROL_TOKEN" },
  assistant: { endpoint: "MONOCODE_CONTROL_ENDPOINT", token: "MONOCODE_CONTROL_TOKEN" },
  workflow: { endpoint: "MONOCODE_WORKFLOW_ENDPOINT", token: "MONOCODE_WORKFLOW_TOKEN" },
} as const;
type ControlNamespace = keyof typeof NAMESPACE_ENV;

/** One short authenticated socket request. Longer operations poll with the same receipt ID. */
export async function requestControl(namespace: ControlNamespace, action: string, input: Record<string, unknown>, requestId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const endpoint = process.env[NAMESPACE_ENV[namespace].endpoint]?.match(/^127\.0\.0\.1:(\d+)$/);
  const token = process.env[NAMESPACE_ENV[namespace].token];
  if (!endpoint || !token) throw new Error("Host control access is unavailable for this process");
  if (signal?.aborted) throw new Error("Control request interrupted; retry the same request ID");
  return new Promise((resolve, reject) => {
    const socket = connect(Number(endpoint[1]), "127.0.0.1");
    let data = "";
    const abort = () => socket.destroy(new Error("Control request interrupted; retry the same request ID"));
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("close", () => signal?.removeEventListener("abort", abort));
    socket.setTimeout(32_000, () => socket.destroy(new Error("Control request timed out; retry the same request ID")));
    socket.on("error", reject);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ namespace, token, requestId, action, input })}\n`));
    socket.on("data", (part) => { data += part; if (data.length > 8_000_000) socket.destroy(new Error("Control response is too large")); });
    socket.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid Host control response")); } });
  });
}

/** Credentials are ephemeral, lead-scoped and never accepted by device RPC. */
export class HostControl {
  private grants = new Map<string, string>();
  private sockets = new Set<Socket>();
  private server: Server;
  private endpoint = "";
  readonly ready: Promise<void>;
  constructor(private handle: (leadId: string, requestId: string, action: string, input: Record<string, unknown>, authorize: () => boolean) => Promise<unknown>, private options: { namespace?: ControlNamespace; actions?: readonly string[] } = {}) {
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => {});
      socket.setTimeout(35_000, () => socket.destroy());
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (part) => {
        data += part;
        if (data.length > 1_000_000) { socket.destroy(); return; }
        const line = data.indexOf("\n");
        if (line < 0) return;
        socket.removeAllListeners("data");
        void this.request(data.slice(0, line)).then((reply) => socket.end(`${JSON.stringify(reply)}\n`));
      });
    });
    this.ready = new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server.address();
        if (!address || typeof address === "string") { reject(new Error("Could not start Host control")); return; }
        this.endpoint = `127.0.0.1:${address.port}`;
        this.server.unref();
        resolve();
      });
    });
  }
  private async request(line: string) {
    try {
      const request = JSON.parse(line);
      const lead = [...this.grants].find(([, token]) => token === request.token)?.[0];
      if (!lead || request.namespace !== (this.options.namespace ?? "control")) throw new Error("Connection revoked or unauthorized");
      if (typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 128 || request.requestId.includes("\0") || !(this.options.actions ?? ACTIONS).includes(request.action)) throw new Error("Invalid control request");
      if (!request.input || typeof request.input !== "object" || Array.isArray(request.input)) throw new Error("Control input must be an object");
      const authorize = () => this.grants.get(lead) === request.token;
      const result = await this.handle(lead, request.requestId, request.action, request.input, authorize);
      if (this.options.namespace === "assistant" && !authorize()) throw new Error("Connection revoked or unauthorized");
      if (request.action === "wait" && !authorize()) throw new Error("Connection revoked or unauthorized");
      return { ok: true, result };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error), ...(this.options.namespace === "assistant" ? { code: botErrorCode(error) } : {}) }; }
  }
  enable(id: string) { this.grants.set(id, randomBytes(32).toString("base64url")); }
  disable(id: string) { this.grants.delete(id); }
  environment(id: string): Record<string, string> {
    const token = this.grants.get(id);
    const names = NAMESPACE_ENV[this.options.namespace ?? "control"];
    return token ? { [names.endpoint]: this.endpoint, [names.token]: token } : {};
  }
  async launcher(directory: string, entry: string, node = process.execPath): Promise<string> {
    await this.ready;
    if (currentMachineIO().key !== "local") return wslControlLauncher(currentMachineIO());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, process.platform === "win32" ? "monocode-control.cmd" : "monocode-control");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const content = process.platform === "win32"
      ? `@echo off\r\n"${node.replaceAll('"', '')}" "${entry.replaceAll('"', '')}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(node)} ${quote(entry)} "$@"\n`;
    await writeFile(path, content, { mode: 0o700 });
    if (process.platform !== "win32") await chmod(path, 0o700);
    return path;
  }
  async close() {
    this.grants.clear();
    for (const socket of this.sockets) socket.destroy();
    await this.ready.catch(() => undefined);
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

export async function runControlCli(args: string[], namespace: ControlNamespace = "control"): Promise<number> {
  if (args[0] === "--help" || !args[0]) { process.stdout.write(namespace === "control" ? `${CONTROL_HELP}\n` : namespace === "workflow" ? `${WORKFLOW_HELP}\n` : "OmniCode assistant control: assistant ACTION --input FILE|- --request-id ID. Discover agents/projects/sessions, create and manage conversations, or call workspace.run. Retry uncertain calls with the same request ID.\n"); return 0; }
  let requestId: string = randomUUID();
  try {
    const known = new Set(["--json", "--input", "--request-id"]);
    const seen = new Set<string>();
    for (let i = 1; i < args.length; i += 2) {
      if (!known.has(args[i]) || seen.has(args[i]) || !args[i + 1]) throw new Error("Unknown, duplicate or incomplete control option");
      seen.add(args[i]);
    }
    const option = (key: string) => { const i = args.indexOf(key); if (i < 0) return undefined; if (!args[i + 1]) throw new Error(`Missing ${key} value`); return args[i + 1]; };
    requestId = option("--request-id") ?? requestId;
    if (!requestId || requestId.length > 128 || requestId.includes("\0")) throw new Error("Invalid request ID");
    if (namespace === "control" ? !ACTIONS.includes(args[0]) : namespace === "workflow" ? !WORKFLOW_ACTIONS.includes(args[0]) : !/^[a-z]+\.[a-zA-Z_]+$/.test(args[0])) throw new Error(`Unknown ${namespace} action; run ${namespace} --help`);
    const json = option("--json"), file = option("--input");
    if (json && file) throw new Error("Use either --json or --input");
    const input = JSON.parse(json ?? (file ? readFileSync(file === "-" ? 0 : file, "utf8") : "{}"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Control input must be an object");
    const reply = await requestControl(namespace, args[0], input, requestId);
    process.stdout.write(`${JSON.stringify({ ...reply, requestId })}\n`);
    return reply.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, requestId, error: error instanceof Error ? error.message : String(error) })}\n`);
    return 1;
  }
}
