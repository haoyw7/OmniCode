import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { HostChildBackend } from "./child-backend";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { hostProviders } from "./providers";
import { acquireHarnessBridge, configureChildBackend } from "../src/integrations/harness/core/child";

// Opt-in real-CLI proof: only inference HTTP is replaced. The installed CLI,
// retry loop, subprocess transport, production adapter and Host persistence run.
// Supply binary/JS-entry paths; no account credentials or public model API is used.
const binaries = {
  codex: process.env.OMNICODE_NETWORK_CODEX_BINARY,
  pi: process.env.OMNICODE_NETWORK_PI_BINARY,
  deepseek: process.env.OMNICODE_NETWORK_DSH_BINARY,
  antigravity: process.env.OMNICODE_NETWORK_AGY_BINARY,
};
const output = resolve("build/harness-network");
const sentinel = "OMNICODE_NETWORK_TOOL_OK";
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { const finish = cleanup; cleanup = undefined; await finish?.(); });

function event(res: ServerResponse, type: string, payload: object) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}

function codexResponse(res: ServerResponse, id: string, item: Record<string, unknown>) {
  event(res, "response.created", { response: { id, status: "in_progress", output: [] } });
  event(res, "response.output_item.added", { output_index: 0, item });
  if (item.type === "message") event(res, "response.output_text.delta", {
    item_id: item.id, output_index: 0, content_index: 0, delta: "NETWORK_RECOVERED",
  });
  event(res, "response.output_item.done", { output_index: 0, item });
  event(res, "response.completed", {
    response: { id, status: "completed", output: [item],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } },
  });
  res.end();
}

describe.each(["codex", "pi", "deepseek", "antigravity"] as const)("real %s network recovery", (harness) => {
  it.skipIf(!binaries[harness])("shows retry and terminal failure, resumes tools after recovery, and accepts a new turn after failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "omnicode-network-"));
    const workspace = join(root, "workspace");
    const home = join(root, "provider-home");
    mkdirSync(workspace);
    mkdirSync(home);
    mkdirSync(output, { recursive: true });
    writeFileSync(join(workspace, "verification.txt"), sentinel);
    let online = false;
    let requests = 0;
    let drops = 0;
    let terminalResponses = 0;
    let toolResultsObserved = 0;
    let responseId = 0;
    let terminalAfterDrop: number | undefined;
    let runtimeVersion: string | undefined;
    const requestLog: Array<{ at: number; online: boolean; toolResult: boolean }> = [];
    const server = createServer(async (req, res) => {
      if (req.method !== "POST") { res.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests++;
      const raw = JSON.stringify(harness === "codex" ? body.input
        : harness === "antigravity" ? body.contents : body.messages);
      const toolResult = raw.includes(sentinel);
      if (harness === "antigravity")
        writeFileSync(join(output, "antigravity-request.json"), JSON.stringify(body, null, 2));
      requestLog.push({ at: Date.now(), online, toolResult });
      if (!online) {
        if (terminalAfterDrop !== undefined && drops >= terminalAfterDrop) {
          terminalResponses++;
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT",
            message: "Network fixture: proxy cannot forward this request" } }));
          return;
        }
        drops++;
        if (harness === "codex") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          event(res, "response.created", { response: { id: `drop_${drops}`, status: "in_progress", output: [] } });
          setTimeout(() => res.destroy(), 80);
        } else req.socket.destroy();
        return;
      }
      if (toolResult) toolResultsObserved++;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const id = `response_${++responseId}`;
      if (harness === "codex") {
        const name = body.tools?.some((tool: { name?: string }) => tool.name === "exec_command")
          ? "exec_command" : "shell_command";
        codexResponse(res, id, toolResult
          ? { id: `${id}_message`, type: "message", role: "assistant", phase: "final_answer", status: "completed",
              content: [{ type: "output_text", text: "NETWORK_RECOVERED", annotations: [] }] }
          : { id: `${id}_tool`, type: "function_call", call_id: `${id}_call`, name,
              arguments: JSON.stringify(name === "exec_command"
                ? { cmd: `echo ${sentinel}`, max_output_tokens: 1000 }
                : { command: `echo ${sentinel}` }), status: "completed" });
      } else if (harness === "deepseek") {
        event(res, "message_start", { message: { id, type: "message", role: "assistant",
          model: body.model, content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 } } });
        event(res, "content_block_start", { index: 0, content_block: toolResult
          ? { type: "text", text: "" }
          : { type: "tool_use", id: `${id}_call`, name: "read", input: {} } });
        event(res, "content_block_delta", { index: 0, delta: toolResult
          ? { type: "text_delta", text: "NETWORK_RECOVERED" }
          : { type: "input_json_delta", partial_json: JSON.stringify({ file_path: join(workspace, "verification.txt") }) } });
        event(res, "content_block_stop", { index: 0 });
        event(res, "message_delta", { delta: { stop_reason: toolResult ? "end_turn" : "tool_use",
          stop_sequence: null }, usage: { output_tokens: 10 } });
        event(res, "message_stop", {});
        res.end();
      } else if (harness === "antigravity") {
        const tools = body.tools?.flatMap((tool: { functionDeclarations?: unknown[] }) => tool.functionDeclarations ?? []);
        const read = tools?.find((tool: { name: string }) => /^(read|read_file|view_file)$/.test(tool.name));
        const properties = (read?.parametersJsonSchema ?? read?.parameters)?.properties ?? {};
        const pathKey = Object.keys(properties).find(key => /path/i.test(key)) ?? "path";
        res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: toolResult
          ? [{ text: "NETWORK_RECOVERED" }]
          : [{ functionCall: { name: read?.name ?? "read_file", args: {
            [pathKey]: join(workspace, "verification.txt"),
            toolSummary: "Fixture verification", toolAction: "Reading fixture",
          } } }] },
          finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } })}\n\n`);
      } else {
        const delta = toolResult ? { role: "assistant", content: "NETWORK_RECOVERED" }
          : { role: "assistant", tool_calls: [{ index: 0, id: `${id}_call`, type: "function",
              function: { name: "read", arguments: JSON.stringify({ path: join(workspace, "verification.txt") }) } }] };
        res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "network-fixture",
          choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "network-fixture",
          choices: [{ index: 0, delta: {}, finish_reason: toolResult ? "stop" : "tool_calls" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
        res.end("data: [DONE]\n\n");
      }
    });
    await new Promise<void>(yes => server.listen(0, "127.0.0.1", yes));
    const closeFixture = async () => {
      server.closeAllConnections();
      await new Promise<void>(yes => server.close(() => yes()));
      // Only remove this test's unique, verified temporary directory.
      if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("omnicode-network-"))
        await rm(root, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
    };
    cleanup = closeFixture;
    const port = (server.address() as { port: number }).port;
    if (harness === "codex") {
      writeFileSync(join(home, "config.toml"), [
        'model_provider = "network_fixture"',
        'model = "gpt-5.4"',
        '[model_providers.network_fixture]',
        'name = "OmniCode network fixture"',
        `base_url = "http://127.0.0.1:${port}/v1"`,
        'wire_api = "responses"',
        'requires_openai_auth = false',
        'supports_websockets = false',
        'request_max_retries = 0',
        'stream_max_retries = 2',
        'stream_idle_timeout_ms = 1000',
      ].join("\n"));
    } else if (harness === "pi") {
      writeFileSync(join(home, "models.json"), JSON.stringify({ providers: { network_fixture: {
        baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "local-fixture-only",
        models: [{ id: "network-fixture", contextWindow: 32768, maxTokens: 4096, reasoning: false }],
      } } }));
      writeFileSync(join(home, "settings.json"), JSON.stringify({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 200, maxAgentDelayMs: 500,
          provider: { maxRetries: 0, timeoutMs: 2000 } },
      }));
    }
    // Add only endpoint/retry configuration to the real reserved bridge profile.
    // The native provider's transport, retry plugin and tools remain unmodified.
    const patchPath = join(home, "network.patch.yml");
    if (harness === "deepseek") writeFileSync(patchPath, JSON.stringify([
      { id: "llm-deepseek", config: { baseURL: `http://127.0.0.1:${port}/anthropic`,
        apiKeyEnv: "OMNICODE_NETWORK_KEY", thinking: "disabled",
        retryPolicy: { mode: "normal", maxRetries: 2,
          backoff: { initialDelayMs: 500, maxDelayMs: 1000, jitterRatio: 0 } } } },
      { id: "llm-deepseek-account", disabled: true },
      { id: "session-title-llm", disabled: true },
    ]));
    if (harness === "antigravity") {
      mkdirSync(join(home, "antigravity-acp"));
      writeFileSync(join(home, "antigravity-acp/settings.json"),
        JSON.stringify({ auth: { type: "gemini-api-key" } }));
    }
    class NetworkBackend extends HostChildBackend {
      override async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
        const result = await super.invoke<T>(command, args);
        if (command === "harness_prepare_deepseek_bridge") {
          const launch = result as { path: string; args: string[] };
          return { ...launch, args: [...launch.args, "--patch", patchPath] } as T;
        }
        return result;
      }
    }
    const backend = new NetworkBackend({ [harness]: binaries[harness]! });
    if (harness === "antigravity") {
      const wire: unknown[] = [];
      await backend.listen("harness-stdout", ({ payload }) => {
        wire.push(payload);
        try {
          const frame = JSON.parse((payload as { line: string }).line);
          runtimeVersion ??= frame.result?.agentInfo?.version;
        } catch { /* Startup diagnostics are not protocol frames. */ }
        writeFileSync(join(output, "antigravity-wire.json"), JSON.stringify(wire, null, 2));
      });
    }
    backend.configureSessionEnvironment(() => ({
      ...(harness === "codex" ? { CODEX_HOME: home } : harness === "pi"
        ? { PI_CODING_AGENT_DIR: home } : harness === "deepseek"
          ? { DSH_HOME: home, OMNICODE_NETWORK_KEY: "local-fixture-only" }
          : { GEMINI_HOME: home, HOME: home, USERPROFILE: home,
            GEMINI_API_KEY: "local-fixture-only", GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${port}` }),
      OPENAI_API_KEY: "", CODEX_API_KEY: "", CODEX_ACCESS_TOKEN: "",
      HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1,localhost",
    }));
    configureChildBackend(backend);
    const release = await acquireHarnessBridge();
    const store = new HostStore(join(root, "host.db"));
    const engine = new HostEngine(store, hostProviders);
    cleanup = async () => {
      await engine.close();
      await backend.close();
      release();
      store.close();
      // The bridge tears down on the next event-loop turn; allow the next CLI
      // to install its own backend after listeners and child exits have drained.
      await new Promise(yes => setTimeout(yes, 50));
      await closeFixture();
    };
    await engine.ready;
    const project = await engine.openProject(workspace);
    const { sessionId } = engine.command({ type: "create", commandId: `create-${harness}`,
      projectId: project.id, harness, model: harness === "codex" ? "codex:gpt-5.4"
        : harness === "pi" ? "pi:network_fixture/network-fixture"
          : harness === "deepseek" ? "deepseek:default" : "antigravity:gemini-3.8-flash",
      runtimeMode: "full-access" });
    const state = () => store.session(sessionId);
    const snapshot = (name: string) => {
      const current = state();
      writeFileSync(join(output, `${harness}-${name}.json`), JSON.stringify(current, null, 2));
      return current;
    };
    const releaseResources = cleanup;
    cleanup = async () => {
      snapshot("last-state");
      writeFileSync(join(output, `${harness}-requests.json`), JSON.stringify(requestLog, null, 2));
      await releaseResources();
    };
    const send = (name: string) => engine.command({
      type: "send", commandId: `${harness}-${name}`, sessionId,
      text: "Use a tool to inspect the fixture, then report its completion.",
    });
    send("recover");
    const retryVisible = () => state().session.blocks.some(block =>
      block.notice === "warning" && block.statusKey === `${harness}-retry`);
    await vi.waitFor(() => expect(retryVisible() || state().status === "idle").toBe(true),
      { timeout: harness === "antigravity" ? 150_000 : 75_000, interval: 50 });
    expect(retryVisible(), JSON.stringify(state().session.blocks)).toBe(true);
    expect(drops).toBeGreaterThan(0);
    expect(snapshot("retrying").status).toBe("running");
    online = true;
    await vi.waitFor(() => expect(state().status).toBe("idle"), { timeout: harness === "antigravity" ? 150_000 : 45_000, interval: 50 });
    expect(state().session.blocks.some(block => block.text.includes("NETWORK_RECOVERED"))).toBe(true);
    expect(toolResultsObserved).toBeGreaterThan(0);
    expect(state().session.blocks.some(block => block.role === "tool" &&
      block.tool?.status === "completed" &&
      (harness === "antigravity" || block.tool.detail?.includes(sentinel)))).toBe(true);
    expect(state().session.blocks.some(block => block.notice === "error")).toBe(false);
    snapshot("recovered");
    const providerSessionId = state().session.providerSessionId;

    online = false;
    // AGY's native backoff lasts minutes and is not configurable over ACP.
    // Exercise one real EOF retry, followed by a non-retryable proxy failure.
    // The other providers exhaust their configured native retry budget.
    if (harness === "antigravity") terminalAfterDrop = drops + 1;
    send("exhaust");
    await vi.waitFor(() => expect(state().status).toBe("idle"), { timeout: harness === "antigravity" ? 180_000 : 45_000, interval: 50 });
    const failed = snapshot("failed");
    expect(failed.session.blocks.some(block => block.notice === "error")).toBe(true);
    if (harness === "antigravity")
      expect(failed.session.blocks.filter(block => block.text === "Network fixture: proxy cannot forward this request"))
        .toEqual([expect.objectContaining({ notice: "error" })]);
    expect(failed.session.blocks.some(block => block.notice === "warning")).toBe(true);
    const boundary = failed.session.blocks.length;

    online = true;
    send("after-failure");
    await vi.waitFor(() => expect(state().status).toBe("idle"), { timeout: harness === "antigravity" ? 150_000 : 45_000, interval: 50 });
    const resumed = snapshot("continued");
    expect(resumed.session.providerSessionId).toBe(providerSessionId);
    expect(resumed.session.blocks.slice(boundary).some(block => block.text.includes("NETWORK_RECOVERED"))).toBe(true);
    expect(resumed.session.blocks.slice(boundary).some(block => block.notice === "error")).toBe(false);
    const binary = binaries[harness]!;
    const version = harness === "antigravity" ? runtimeVersion : execFileSync(/\.[cm]?js$/i.test(binary) ? process.execPath : binary,
      [...(/\.[cm]?js$/i.test(binary) ? [binary] : []), "--version"], { encoding: "utf8", windowsHide: true }).trim();
    expect(version).toBeTruthy();
    writeFileSync(join(output, `${harness}-result.json`), JSON.stringify({
      harness, version, requests, drops, terminalResponses, toolResultsObserved, requestLog,
      terminalFailure: harness === "antigravity" ? "EOF retry then HTTP 400 proxy failure" : "native retry budget exhausted",
      checks: ["retry visible while running", "recovery executes a real tool", "terminal failure shows error",
        "same conversation continues after terminal failure"],
    }, null, 2));
    console.log(JSON.stringify({ harness, version, requests, drops, terminalResponses, toolResultsObserved }));
    // The persisted view, consumed by desktop/mobile, retains the actual errors.
    expect(JSON.parse(readFileSync(join(output, `${harness}-failed.json`), "utf8")).session.blocks
      .some((block: { notice?: string }) => block.notice === "error")).toBe(true);
  }, harness === "antigravity" ? 360_000 : 150_000);
});
