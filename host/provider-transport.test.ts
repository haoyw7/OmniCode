import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostChildBackend } from "./child-backend";
import { HostStore } from "./store";
import { applySessionSync } from "../src/features/connections/model/protocol";
import { HostEngine } from "./engine";
import { hostProviders } from "./providers";
import { attachmentPath, readAttachmentChunk } from "./attachments";
import { discoverCodexModels } from "../src/integrations/harness/providers/codex/codexCatalog";
import { discoverClaudeModels } from "../src/integrations/harness/providers/claude/claudeCatalog";
import { discoverPiModels, discoverOmpModels } from "../src/integrations/harness/providers/pi/piCatalog";
import {
  acquireHarnessBridge,
  configureChildBackend,
} from "../src/integrations/harness/core/child";

// Real subprocesses exercise framing, startup, stdout delivery and teardown
// through the existing production adapters without contacting a paid model.
const fixture = `#!/usr/bin/env node
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
// Records what each turn actually received, so tests can prove that settings
// applied between turns reach the provider.
const record = value => require('node:fs').appendFileSync(require('node:path').join(__dirname, 'calls.log'), JSON.stringify(value) + '\\n');
let pendingPiDialog;
let piThinking = "off";
const completePi = () => {
  send({type: 'message_update', assistantMessageEvent: {type: 'text_delta', delta: 'Headless Pi completed'}});
  send({type: 'message_end', message: {role: 'assistant', usage: {input: 20000, output: 1000, cacheRead: 4000, cacheWrite: 0, totalTokens: 25000}}});
  send({type: 'agent_settled'});
};
if (!process.argv.includes('app-server')) record({claudeArgs: process.argv.slice(2)});
readline.createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (request.jsonrpc === '2.0') {
    if (request.id == null) return;
    if (['session/load', 'session/resume'].includes(request.method) && request.params?.sessionId?.startsWith('locked-')) {
      const errors = {
        'locked-fx': 'Session is busy',
        'locked-hermes': 'This chat is open in another Hermes window/terminal. Use it there, or start a new chat here.',
        'locked-cursor': 'Chat fixture is already running in persistent session background',
      };
      send({jsonrpc: '2.0', id: request.id, error: {code: -32603, message: errors[request.params.sessionId]}});
      return;
    }
    if (request.method === 'session/prompt') {
      send({jsonrpc: '2.0', method: 'session/update', params: {sessionId: 'fixture_acp', update: {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'Headless ACP completed'}}}});
      send({jsonrpc: '2.0', method: 'session/update', params: {sessionId: 'fixture_acp', update: {sessionUpdate: 'usage_update', used: 25000, size: 100000}}});
      setTimeout(() => send({jsonrpc: '2.0', id: request.id, result: {stopReason: 'end_turn'}}), 30);
    } else {
      send({jsonrpc: '2.0', id: request.id, result: request.method === 'session/new' || request.method === 'session/load' || request.method === 'session/resume' ? {sessionId: 'fixture_acp', configOptions: []} : {}});
    }
    return;
  }
  if (request.method === 'initialize') send({id: request.id, result: {}});
  if (request.method === 'account/read') send({id: request.id, result: {account: {type: 'fixture'}, requiresOpenaiAuth: false}});
  if (request.method === 'model/list') send({id: request.id, result: {data: [{model: 'fixture-model', displayName: 'Fixture model', supportedReasoningEfforts: ['low', 'high']}], nextCursor: null}});
  if (request.method === 'thread/start' || request.method === 'thread/resume') send({id: request.id, result: {thread: {id: 'fixture-thread'}}});
  if (request.method === 'turn/start') {
    record({codexEffort: request.params.effort ?? null, input: request.params.input});
    send({id: request.id, result: {turn: {id: 'fixture-turn'}}});
    const prompt = request.params.input.find(item => item.type === 'text')?.text;
    if (prompt === 'fixture-large-image-event') {
      send({method: 'item/completed', params: {threadId: 'fixture-thread', turnId: 'fixture-turn', item: {
        type: 'userMessage', id: 'user-image', content: [{type: 'image', url: 'data:image/png;base64,' + 'a'.repeat(28 * 1024 * 1024)}]
      }}});
    }
    if (prompt === 'fixture-output-overflow' || prompt === 'fixture-diagnostic-overflow') {
      const stream = prompt === 'fixture-output-overflow' ? process.stdout : process.stderr;
      stream.write('x'.repeat((prompt === 'fixture-output-overflow' ? 64 : 8) * 1024 * 1024 + 1));
      stream.write('truncated-tail\\n');
      return;
    }
    setTimeout(() => {
      send({method: 'item/agentMessage/delta', params: {threadId: 'fixture-thread', turnId: 'fixture-turn', itemId: 'message', delta: 'Headless Codex completed'}});
      send({method: 'thread/tokenUsage/updated', params: {threadId: 'fixture-thread', tokenUsage: {last: {totalTokens: 25000}, modelContextWindow: 100000}}});
      send({method: 'turn/completed', params: {threadId: 'fixture-thread', turn: {id: 'fixture-turn', status: 'completed'}}});
    }, 30);
  }
  if (request.type === 'control_request' && request.request.subtype === 'initialize') {
    send({type: 'system', subtype: 'init', session_id: 'fixture-claude'});
    send({type: 'control_response', response: {subtype: 'success', request_id: request.request_id}});
  }
  if (request.type === 'control_request' && request.request.subtype === 'list_models') send({type: 'control_response', response: {subtype: 'success', request_id: request.request_id, response: {models: [{value: 'claude-fixture-model', resolvedModel: 'claude-fixture-model', displayName: 'Fixture Claude'}]}}});
  if (request.type === 'control_request' && request.request.subtype === 'get_binary_version') send({type: 'control_response', response: {subtype: 'success', request_id: request.request_id, response: {version: '2.1.289'}}});
  if (request.type === 'control_request' && request.request.subtype === 'get_context_usage') {
    record({claudeContextDetail: request.request.detail});
    send({type: 'control_response', response: {subtype: 'success', request_id: request.request_id, response: {totalTokens: 25000, maxTokens: 80000, rawMaxTokens: 100000}}});
  }
  if (request.type === 'user') setTimeout(() => {
    send({type: 'assistant', session_id: 'fixture-claude', message: {content: [{type: 'text', text: 'Headless Claude completed'}], usage: {input_tokens: 20000, output_tokens: 1000, cache_read_input_tokens: 4000}}});
    send({type: 'result', subtype: 'success', session_id: 'fixture-claude'});
  }, 30);
  if (request.type === 'get_state') send({type: 'response', id: request.id, command: 'get_state', success: true, data: {sessionId: 'fixture_pi', model: {provider: 'openai', id: 'fixture-model', contextWindow: 100000}, thinkingLevel: piThinking}});
  if (request.type === 'get_session_stats') send({type: 'response', id: request.id, command: 'get_session_stats', success: true, data: {contextUsage: {tokens: 25000, contextWindow: 100000}}});
  if (request.type === 'get_available_models') send({type: 'response', id: request.id, command: 'get_available_models', success: true, data: {models: [{provider: 'openai', id: 'fixture-model', name: 'Fixture model', reasoning: true, thinkingLevelMap: {minimal: null, low: null, medium: null, high: 'high'}}]}});
  if (request.type === 'get_available_thinking_levels') send({type: 'response', id: request.id, command: request.type, success: true, data: {levels: ['off', 'high']}});
  if (request.type === 'set_thinking_level') { piThinking = request.level === 'off' ? 'off' : 'high'; send({type: 'response', id: request.id, command: request.type, success: true}); }
  if (request.type === 'get_commands') send({type: 'response', id: request.id, command: request.type, success: true, data: {commands: [{name:'fixture-handled', source:'extension'}, {name:'fixture-template', source:'prompt'}, {name:'skill:fixture', source:'skill'}]}});
  if (request.type === 'get_available_commands') send({type: 'response', id: request.id, command: request.type, success: true, data: {commands: [{name:'audit', description:'Native audit', source:'skill', aliases:['review'], input:{hint:'<path>'}}, {name:'plan', source:'builtin'}]}});
  if (request.type === 'abort') { pendingPiDialog = undefined; send({type:'response', id:request.id, command:request.type, success:true}); }
  if (request.type === 'extension_ui_response' && pendingPiDialog === request.id) {
    record({piReply: request}); pendingPiDialog = undefined; completePi();
  }
  if (request.type === 'steer') {
    record({piSteer: request.message});
    send({type:'response', id:request.id, command:'steer', success:true, data:{disposition:'queued'}});
    setTimeout(completePi, 30);
  }
  if (request.type === 'prompt') {
    record({piPrompt: request.message, piThinking});
    if (request.message === '/fixture-handled') {
      send({type:'response', id:request.id, command:'prompt', success:true, data:{disposition:'handled'}});
      return;
    }
    send({type: 'response', id: request.id, command: 'prompt', success: true, data: {disposition:'started'}});
    if (request.message === 'fixture-steer') {
      send({type:'agent_start'}); send({type:'agent_end', isTerminal:false});
      send({type:'message_update', assistantMessageEvent:{type:'text_delta', delta:'Waiting for steer'}});
      return;
    }
    if (request.message === 'fixture-editor') {
      pendingPiDialog = 'fixture-editor';
      send({type:'extension_ui_request', id:pendingPiDialog, method:'editor', title:'Edit text', prefill:'  line one\\nline two  '});
      return;
    }
    setTimeout(() => {
      if (request.message === 'fixture-png') {
        const result = {content:[{type:'text', text:'Fixture PNG'}, {type:'image', mimeType:'image/png', data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='}]};
        send({type:'tool_execution_start', toolCallId:'fixture-image', toolName:'codemode', args:{}});
        send({type:'tool_execution_end', toolCallId:'fixture-image', toolName:'codemode', result, isError:false});
      }
      completePi();
    }, 30);
  }
});
`;

describe("existing providers over headless process I/O", () => {
  let directory: string;
  let backend: HostChildBackend;
  let release: () => void;
  let store: HostStore;
  let engine: HostEngine;
  beforeAll(async () => {
    directory = realpathSync(
      mkdtempSync(join(tmpdir(), "monocode-provider-test-")),
    );
    const binary = join(directory, "provider.cjs");
    writeFileSync(binary, fixture, { mode: 0o700 });
    backend = new HostChildBackend({
      codex: binary,
      claude: binary,
      pi: binary,
      omp: binary,
      cursor: binary,
      grok: binary,
      fx: binary,
      hermes: binary,
      antigravity: binary,
    });
    configureChildBackend(backend);
    release = await acquireHarnessBridge();
    store = new HostStore(join(directory, "host.db"));
    engine = new HostEngine(store, hostProviders);
  });
  afterAll(async () => {
    await engine?.close();
    await backend?.close();
    release?.();
    store?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  function expectPersistedContext(sessionId: string): void {
    const reopened = new HostStore(join(directory, "host.db"));
    try {
      expect(reopened.session(sessionId).session.context).toEqual({ used: 25_000, window: 100_000 });
      // Protocol serialization is the path consumed by mobile and remote desktop.
      const sync = JSON.parse(JSON.stringify(reopened.sync(sessionId)));
      expect(applySessionSync(undefined, sync).session.context).toEqual({ used: 25_000, window: 100_000 });
    } finally {
      reopened.close();
    }
  }

  it.each(["pi", "omp"] as const)("discovers %s native skill commands over the real Host child backend", async (harness) => {
    const project = await engine.openProject(directory);
    const catalog = await engine.listSkills(project.id, harness);
    expect(catalog.native).toBe(true);
    if (harness === "pi") {
      expect(catalog.skills).toContainEqual(expect.objectContaining({ kind: "native", name: "fixture", invocation: "skill:fixture", source: "pi" }));
      expect(catalog.skills).toContainEqual(expect.objectContaining({ invocation: "fixture-handled" }));
    } else {
      expect(catalog.skills).toContainEqual(expect.objectContaining({ kind: "native", name: "audit", aliases: ["review"], inputHint: "<path>", source: "omp" }));
      expect(catalog.skills).toContainEqual(expect.objectContaining({ invocation: "omp:plan" }));
    }
  });

  it("discovers host models in parallel without probe process collisions", async () => {
    const [codexA, codexB, claudeA, claudeB, piA, piB, ompA, ompB] = await Promise.all([
      discoverCodexModels(directory),
      discoverCodexModels(directory),
      discoverClaudeModels(directory),
      discoverClaudeModels(directory),
      discoverPiModels(directory),
      discoverPiModels(directory),
      discoverOmpModels(directory),
      discoverOmpModels(directory),
    ]);
    expect(codexA).toEqual(codexB);
    expect(codexA[0]).toMatchObject({ id: "codex:fixture-model" });
    expect(claudeA).toEqual(claudeB);
    expect(claudeA[0]).toMatchObject({ nativeId: "claude-fixture-model" });
    expect(piA).toEqual(piB);
    expect(piA[0]).toMatchObject({ id: "pi:openai/fixture-model" });
    expect(piA[0].settings?.[0]).toMatchObject({ value: "high", options: [
      { value: "off", label: "Off" }, { value: "high", label: "High" },
    ] });
    expect(ompA).toEqual(ompB);
    expect(ompA[0]).toMatchObject({ id: "omp:openai/fixture-model" });
    expect(ompA[0].settings?.[0].value).toBe("medium");
  });

  it.each([
    ["fx", "Session is busy"],
    ["hermes", "This chat is open in another Hermes window/terminal. Use it there, or start a new chat here."],
    ["cursor", "Chat fixture is already running in persistent session background"],
  ] as const)("preserves %s history and binding when its native session is occupied", async (harness, message) => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: `create-locked-${harness}`, projectId: project.id, harness, model: `${harness}:test`, runtimeMode: "supervised" });
    const previous = store.session(sessionId);
    store.save({ ...previous, revision: previous.revision + 1, session: { ...previous.session, providerSessionId: `locked-${harness}`, blocks: [{ id: "saved", role: "assistant", text: "Saved history" }] } }, { type: "fixture.bind" });
    engine.command({ type: "send", commandId: `send-locked-${harness}`, sessionId, text: "Continue" });
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 4_000 });
    const saved = store.session(sessionId).session;
    expect(saved.providerSessionId).toBe(`locked-${harness}`);
    expect(saved.blocks[0].text).toBe("Saved history");
    expect(saved.blocks.at(-1)?.text).toBe(message);
    expect(saved.blocks.some(block => block.text === "Headless ACP completed")).toBe(false);
  });

  it("receives a large image event and then completes the Codex answer", async () => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: "create-large-image",
      projectId: project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
    engine.command({ type: "send", commandId: "large-image", sessionId, text: "fixture-large-image-event" });
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 4_000 });
    expect(store.session(sessionId).session.blocks.at(-1)).toMatchObject({
      role: "assistant", text: "Headless Codex completed",
    });
    expect(store.session(sessionId).session.blocks.some(block => block.notice === "error")).toBe(false);
  });

  it("sends multiple large uploaded images as Codex local paths without inline data", async () => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: "create-local-images",
      projectId: project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
    const refs = [16, 2, 3].map((size, index) => ({
      id: `dddddddd-dddd-4ddd-8ddd-ddddddddddd${index}`,
      name: `image-${index}.png`, mimeType: "image/png", kind: "image" as const,
      size: size * 1024 * 1024,
    }));
    // Only transport is under test: no image decoding or paid model call.
    mkdirSync(store.attachmentDir, { recursive: true });
    for (const file of refs) writeFileSync(attachmentPath(store, file.id), Buffer.alloc(file.size));
    engine.command({ type: "send", commandId: "local-images", sessionId, text: "Look at these", attachments: refs });
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 4_000 });
    expect(store.session(sessionId).session.blocks.at(-1)?.text).toBe("Headless Codex completed");
    const call = readFileSync(join(directory, "calls.log"), "utf8").trim().split("\n")
      .map(line => JSON.parse(line)).find(row => row.input?.some((item: { text?: string }) => item.text === "Look at these"));
    expect(call.input.filter((item: { type: string }) => item.type !== "text"))
      .toEqual(refs.map(file => ({ type: "localImage", path: attachmentPath(store, file.id) })));
    expect(JSON.stringify(store.session(sessionId))).not.toContain("base64");
  });

  it.each([
    ["fixture-output-overflow", "Agent output exceeded the 64 MiB message limit."],
    ["fixture-diagnostic-overflow", "Agent diagnostic output exceeded the 8 MiB message limit."],
  ])("reports the exact Host limit on %s without parsing truncated output", async (prompt, message) => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: `create-${prompt}`,
      projectId: project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      engine.command({ type: "send", commandId: prompt, sessionId, text: prompt });
      await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 4_000 });
      expect(store.session(sessionId).session.blocks.filter(block => block.notice === "error"))
        .toMatchObject([{ text: message }]);
      expect(log).not.toHaveBeenCalled();
      engine.command({ type: "send", commandId: `${prompt}-recover`, sessionId, text: "Continue" });
      await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 4_000 });
      expect(store.session(sessionId).session.blocks.at(-1)?.text).toBe("Headless Codex completed");
    } finally { log.mockRestore(); }
  });

  it.each(["codex", "claude"] as const)(
    "completes and resumes %s with no React or Tauri process",
    async (harness) => {
      const project = await engine.openProject(directory);
      const { sessionId } = engine.command({
        type: "create",
        commandId: `create-${harness}`,
        projectId: project.id,
        harness,
        model: `${harness}:test`,
        runtimeMode: "supervised",
      });
      for (let turn = 0; turn < 2; turn++) {
        engine.command({
          type: "send",
          commandId: `${harness}-${turn}`,
          sessionId,
          text: "hello",
        });
        await vi.waitFor(
          () => expect(store.session(sessionId).status).toBe("idle"),
          { timeout: 4_000 },
        );
        const state = store.session(sessionId).session;
        expect(
          state.blocks.filter((block) => block.role === "assistant"),
        ).toHaveLength(turn + 1);
        expect(state.blocks.at(-1)?.text).toContain("completed");
        expect(state.providerSessionId).toBeTruthy();
        expect(state.context).toEqual({ used: 25_000, window: 100_000 });
        expectPersistedContext(sessionId);
      }
    },
  );

  it.each(["pi", "omp"] as const)(
    "completes and resumes %s over the host RPC transport",
    async (harness) => {
      const project = await engine.openProject(directory);
      const { sessionId } = engine.command({
        type: "create",
        commandId: `create-${harness}`,
        projectId: project.id,
        harness,
        model: `${harness}:default`,
        runtimeMode: "supervised",
      });
      for (let turn = 0; turn < 2; turn++) {
        engine.command({
          type: "send",
          commandId: `${harness}-send-${turn}`,
          sessionId,
          text: "hello",
        });
        await vi.waitFor(
          () => expect(store.session(sessionId).status).toBe("idle"),
          { timeout: 4_000 },
        );
        const state = store.session(sessionId).session;
        expect(
          state.blocks.filter((block) => block.role === "assistant"),
        ).toHaveLength(turn + 1);
        expect(state.blocks.at(-1)?.text).toContain("Headless Pi completed");
        expect(state.providerSessionId).toBe("fixture_pi");
        expect(state.context).toEqual({ used: 25_000, window: 100_000 });
        expectPersistedContext(sessionId);
      }
    },
  );

  it.each(["pi", "omp"] as const)("steers a shared queued message through the production %s adapter", async harness => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: `create-steer-${harness}`, projectId: project.id,
      harness, model: `${harness}:default`, runtimeMode: "supervised" });
    engine.command({ type: "send", commandId: `held-${harness}`, sessionId, text: "fixture-steer" });
    engine.command({ type: "send", commandId: `queued-${harness}`, sessionId, text: `Steer from ${harness}` });
    await vi.waitFor(() => expect(store.session(sessionId).session.blocks.some(row => row.text === "Waiting for steer")).toBe(true));
    expect(store.session(sessionId).status).toBe("running");
    engine.command({ type: "queue", action: "steer", commandId: `steer-${harness}`, sessionId,
      messageId: `queued-${harness}`, runId: store.session(sessionId).runId });
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"));
    expect(store.session(sessionId).session.queuedMessages).toBeUndefined();
    expect(store.session(sessionId).session.blocks.filter(row => row.role === "user" && row.text === `Steer from ${harness}`)).toHaveLength(1);
    const calls = readFileSync(join(directory, "calls.log"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls.filter(call => call.piSteer === `Steer from ${harness}`)).toHaveLength(1);
  });

  it("persists Pi's effective thinking level and completes messages with a stale default", async () => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: "create-pi-thinking",
      projectId: project.id, harness: "pi", model: "pi:default", runtimeMode: "supervised",
      modelSettings: { thinking: "medium" } });
    for (let turn = 0; turn < 2; turn++) {
      engine.command({ type: "send", commandId: `pi-thinking-${turn}`, sessionId, text: `pi-thinking-${turn}` });
      await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 4_000 });
      const state = store.session(sessionId).session;
      expect(state.blocks.at(-1)?.text).toBe("Headless Pi completed");
      expect(state.blocks.some(block => block.notice === "error")).toBe(false);
      expect(state.modelSettings?.thinking).toBe("high");
      const reopened = new HostStore(join(directory, "host.db"));
      try {
        const sync = JSON.parse(JSON.stringify(reopened.sync(sessionId)));
        expect(applySessionSync(undefined, sync).session.modelSettings?.thinking).toBe("high");
      } finally { reopened.close(); }
    }
    const calls = readFileSync(join(directory, "calls.log"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls.filter(call => call.piPrompt?.startsWith("pi-thinking-"))).toEqual([
      { piPrompt: "pi-thinking-0", piThinking: "high" },
      { piPrompt: "pi-thinking-1", piThinking: "high" },
    ]);
  });

  it("finishes a handled Pi command and accepts the next message", async () => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: "create-pi-handled",
      projectId: project.id, harness: "pi", model: "pi:default", runtimeMode: "supervised" });
    engine.command({ type: "send", commandId: "pi-handled-send", sessionId, text: "/fixture-handled" });
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"));
    expect(store.session(sessionId).session.blocks.some(block => block.notice === "error")).toBe(false);
    engine.command({ type: "send", commandId: "pi-after-handled", sessionId, text: "hello" });
    await vi.waitFor(() => expect(store.session(sessionId).session.blocks.some(block =>
      block.role === "assistant" && block.text.includes("Headless Pi completed"))).toBe(true));
  });

  it("round trips exact Pi editor replies over the Host transport", async () => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: "create-pi-editor",
      projectId: project.id, harness: "pi", model: "pi:default", runtimeMode: "supervised" });
    engine.command({ type: "send", commandId: "pi-editor-send", sessionId, text: "fixture-editor" });
    await vi.waitFor(() => expect(store.session(sessionId).session.pendingQuestion).toBeTruthy());
    const current = store.session(sessionId);
    const question = current.session.pendingQuestion!;
    expect(question.questions[0]?.input).toMatchObject({ kind: "multiline", initialValue: "  line one\nline two  " });
    const value = "  edited\ntext  ";
    engine.command({ type: "answer", commandId: "pi-editor-answer", sessionId,
      runId: current.runId, requestId: question.requestId,
      reply: { kind: "answered", answers: {}, custom: { "fixture-editor": value } } });
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"));
    const calls = readFileSync(join(directory, "calls.log"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls.some(call => call.piReply?.value === value)).toBe(true);
  });

  it("preserves Pi PNG output for a reconnecting desktop client", async () => {
    const project = await engine.openProject(directory);
    const { sessionId } = engine.command({ type: "create", commandId: "create-pi-png",
      projectId: project.id, harness: "pi", model: "pi:default", runtimeMode: "supervised" });
    engine.command({ type: "send", commandId: "pi-png-send", sessionId, text: "fixture-png" });
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"));
    const image = store.session(sessionId).session.blocks.find(block => block.role === "image");
    expect(image?.attachments?.[0]).toMatchObject({ kind: "image", mimeType: "image/png" });
    const file = image!.attachments![0];
    expect(readAttachmentChunk(store, { sessionId, id: file.id, offset: 0 }).data).toContain("iVBOR");
    expect(store.sync(sessionId).kind).toBe("snapshot");
  });

  it.each(["cursor", "grok", "fx", "hermes", "antigravity"] as const)(
    "completes a %s turn over the headless ACP transport",
    async (harness) => {
      const project = await engine.openProject(directory);
      const { sessionId } = engine.command({
        type: "create",
        commandId: `create-${harness}`,
        projectId: project.id,
        harness,
        model: `${harness}:default`,
        runtimeMode: "supervised",
      });
      engine.command({
        type: "send",
        commandId: `${harness}-send`,
        sessionId,
        text: "hello",
      });
      await vi.waitFor(
        () => expect(store.session(sessionId).status).toBe("idle"),
        { timeout: 4_000 },
      );
      const state = store.session(sessionId).session;
      expect(state.blocks.at(-1)?.text).toContain("Headless ACP completed");
      expect(state.providerSessionId).toBe("fixture_acp");
      expect(state.context).toEqual({ used: 25_000, window: 100_000 });
      expectPersistedContext(sessionId);
    },
  );

  it.each([
    ["codex", "reasoningEffort"],
    ["claude", "effort"],
  ] as const)(
    "uses %s reasoning effort applied between turns on the next turn",
    async (harness, setting) => {
      const log = join(directory, "calls.log");
      const project = await engine.openProject(directory);
      const { sessionId } = engine.command({
        type: "create",
        commandId: `effort-create-${harness}`,
        projectId: project.id,
        harness,
        model: `${harness}:test`,
        modelSettings: { [setting]: "low" },
        runtimeMode: "supervised",
      });
      const efforts: Array<string | null> = [];
      for (const [turn, effort] of ["low", "high"].entries()) {
        if (turn)
          engine.command({
            type: "configure",
            commandId: `effort-configure-${harness}`,
            sessionId,
            model: `${harness}:test`,
            modelSettings: { [setting]: effort },
            runtimeMode: "supervised",
          });
        writeFileSync(log, "");
        engine.command({
          type: "send",
          commandId: `effort-${harness}-${turn}`,
          sessionId,
          text: "hello",
        });
        await vi.waitFor(
          () => expect(store.session(sessionId).status).toBe("idle"),
          { timeout: 4_000 },
        );
        const calls = readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        if (harness === "codex")
          efforts.push(calls.find((call) => "codexEffort" in call).codexEffort);
        else {
          const args: string[] = calls.find(
            (call) => call.claudeArgs,
          ).claudeArgs;
          efforts.push(args[args.indexOf("--effort") + 1] ?? null);
        }
      }
      expect(efforts).toEqual(["low", "high"]);
      expect(store.session(sessionId).session.modelSettings).toEqual({
        [setting]: "high",
      });
    },
  );
});
