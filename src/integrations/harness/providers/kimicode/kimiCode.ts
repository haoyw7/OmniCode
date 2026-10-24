import { JsonRpcClient, type JsonRpcId } from "../../core/jsonRpc";
import { translate } from "../../../../shared/i18n/language";
import { botContextPrompt } from "../../core/botContext";
import { AcpSubagents } from "../../core/acpSubagents";
import {
  emitAcpGenerationEvent,
  measureGenerationTurn,
  resetGenerationMetrics,
} from "../../core/generationMetrics";
import {
  nativeAcpTitleEvent,
  noteAcpTitleCapabilities,
  readAcpSessionTitle,
  readAcpTitleInProcess,
} from "../../core/nativeTitles";
import type { NativeTitleInput } from "../../core/titleCoordinator";
import {
  killChild,
  resolveKimiCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import type {
  ApprovalDecision,
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
  UserQuestionReply,
} from "../../core/types";
import {
  eventsFromAcpUpdate,
  grokPromptBlocks,
  permissionRequestFromAcp,
} from "../grok/grokProtocol";
import {
  KIMI_AUTH_HELP,
  kimiConfigOptions,
  kimiMode,
  kimiModelOption,
  kimiPermissionKind,
  kimiPermissionOption,
  kimiQuestion,
  kimiQuestionResponse,
  kimiSettings,
  modelsFromKimiSession,
  record,
  type ConfigOption,
  type KimiModel,
} from "./kimiCodeProtocol";

const CONTROL_TIMEOUT = 20_000;
const SESSION_TIMEOUT = 45_000;
const PROMPT_TIMEOUT = 30 * 60_000;
const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  session: { configOptions: { boolean: {} } },
  elicitation: { form: {} },
};

type Live = {
  rpc: JsonRpcClient;
  cwd: string;
  providerId: string;
  modelId: string;
  modeId: string;
  modes: string[];
  config: ConfigOption[];
  runtimeMode: SendTurnInput["runtimeMode"];
  planning: boolean;
  muted: boolean;
  cancelled: boolean;
  nextRequestId: number;
  approvals: Map<number, (decision: ApprovalDecision) => void>;
  questions: Map<number, (reply: UserQuestionReply) => void>;
  subagents: AcpSubagents;
  onEvent: (event: HarnessEvent) => void;
};
const sessions = new Map<string, Live>();
const resumes = new Map<string, { providerId: string; cwd: string }>();
const cancelled = new Set<string>();

export async function sendKimiCodeTurn(input: SendTurnInput): Promise<void> {
  return measureGenerationTurn(input, async () => {
    let live: Live | undefined;
    try {
      live = await ensureLive(input);
      if (cancelled.delete(input.sessionId) || live.cancelled) return;
      live.onEvent = input.onEvent;
      live.runtimeMode = input.runtimeMode;
      live.planning = input.intent === "plan";
      live.muted = false;
      await configure(live, input);
      if (live.cancelled) return;
      const blocks = grokPromptBlocks(
        botContextPrompt(input.text, input.botContext),
        input.attachments,
      );
      if (!blocks.length) return;
      const pending = live.rpc.request(
        "session/prompt",
        { sessionId: live.providerId, prompt: blocks },
        PROMPT_TIMEOUT,
      );
      input.onAccepted?.();
      await pending;
      if (live.cancelled) return;
      live.onEvent({ type: "message.completed" });
      live.onEvent({ type: "reasoning.completed" });
      live.onEvent({
        type: "session.titleRefreshRequested",
        providerSessionId: live.providerId,
      });
    } catch (error) {
      if (cancelled.delete(input.sessionId) || live?.cancelled) return;
      await stopKimiCodeSession(input.sessionId);
      const detail = error instanceof Error ? error.message : String(error);
      if (
        /auth(?:entication)?[_ .-]?(?:required|error|failed)|not authenticated|unauthorized|token[_ .-]?(?:missing|expired)|api.?key/i.test(
          detail,
        )
      )
        throw new Error(`${detail}\n\n${translate(KIMI_AUTH_HELP)}`);
      throw error;
    }
  });
}

export async function steerKimiCodeTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error(
    translate("Kimi Code does not support steering an in-flight turn."),
  );
}

async function ensureLive(input: SendTurnInput): Promise<Live> {
  const existing = sessions.get(input.sessionId);
  if (existing && existing.cwd === input.cwd && !existing.cancelled)
    return existing;
  if (existing) await stopKimiCodeSession(input.sessionId);
  const resume = resumes.get(input.sessionId);
  if (resume && resume.cwd !== input.cwd) resumes.delete(input.sessionId);
  const { path } = await resolveKimiCodeBinary();
  const rpc = new JsonRpcClient(
    input.sessionId,
    {
      onNotification: (method, params) => {
        if (live.muted || live.cancelled || method !== "session/update") return;
        const envelope = record(params);
        if (
          envelope.sessionId != null &&
          envelope.sessionId !== live.providerId
        )
          return;
        const title = nativeAcpTitleEvent(params, live.providerId);
        if (title) {
          live.onEvent(title);
          return;
        }
        const update = record(envelope.update);
        if (
          update.sessionUpdate === "config_option_update" &&
          Array.isArray(update.configOptions)
        ) {
          live.config = kimiConfigOptions(update.configOptions);
          emitConfig(live);
          return;
        }
        if (
          update.sessionUpdate === "current_mode_update" &&
          typeof update.currentModeId === "string"
        ) {
          live.modeId = update.currentModeId;
          live.planning = live.modeId === "plan";
        }
        const now = performance.now();
        for (const event of live.subagents.route(
          params,
          eventsFromAcpUpdate(params),
        ))
          emitAcpGenerationEvent(
            live.onEvent,
            event,
            params,
            now,
            live.providerId,
          );
      },
      onRequest: (id, method, params) => {
        void handleRequest(live, id, method, params).catch(() => undefined);
      },
    },
    { label: "kimi-acp" },
  );
  const live: Live = {
    rpc,
    cwd: input.cwd,
    providerId: "",
    modelId: "",
    modeId: "",
    modes: [],
    config: [],
    runtimeMode: input.runtimeMode,
    planning: input.intent === "plan",
    muted: true,
    cancelled: false,
    nextRequestId: 1,
    approvals: new Map(),
    questions: new Map(),
    subagents: new AcpSubagents(),
    onEvent: input.onEvent,
  };
  sessions.set(input.sessionId, live);
  watchChild(
    input.sessionId,
    (line) => rpc.pushLine(line),
    (code) => {
      rpc.close(new Error(translate("Kimi Code process exited.")));
      resolveRequests(live);
      resetGenerationMetrics(live.onEvent);
      if (sessions.get(input.sessionId) === live) {
        sessions.delete(input.sessionId);
        live.onEvent({ type: "session.ended", code });
      }
    },
  );
  try {
    await spawnChild(
      input.sessionId,
      path,
      ["acp"],
      input.cwd,
      undefined,
      "kimicode",
    );
    const initialized = await rpc.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "omnicode", version: "0.1.0" },
      },
      CONTROL_TIMEOUT,
    );
    noteAcpTitleCapabilities(rpc, initialized);
    const capabilities = record(record(initialized).agentCapabilities);
    const restored = resume?.cwd === input.cwd ? resume : undefined;
    let setup: unknown;
    if (restored) {
      // A refused/missing native session must never silently start an empty chat.
      const method =
        record(capabilities.sessionCapabilities).resume != null
          ? "session/resume"
          : "session/load";
      setup = await rpc.request(
        method,
        { sessionId: restored.providerId, cwd: input.cwd, mcpServers: [] },
        SESSION_TIMEOUT,
      );
      live.providerId = restored.providerId;
    } else {
      setup = await rpc.request(
        "session/new",
        { cwd: input.cwd, mcpServers: [] },
        SESSION_TIMEOUT,
      );
      const id = record(setup).sessionId;
      if (typeof id !== "string" || !id.trim())
        throw new Error(translate("Kimi Code did not return a session id."));
      live.providerId = id;
    }
    live.config = kimiConfigOptions(record(setup).configOptions);
    live.modelId =
      kimiModelOption(live.config)?.currentValue ??
      String(record(record(setup).models).currentModelId ?? "");
    const modes = record(record(setup).modes);
    live.modeId =
      typeof modes.currentModeId === "string" ? modes.currentModeId : "";
    live.modes = Array.isArray(modes.availableModes)
      ? modes.availableModes.flatMap((item) =>
          typeof record(item).id === "string" ? [String(record(item).id)] : [],
        )
      : [];
    resumes.set(input.sessionId, {
      providerId: live.providerId,
      cwd: input.cwd,
    });
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: live.providerId,
    });
    live.onEvent({ type: "session.started" });
    return live;
  } catch (error) {
    if (sessions.get(input.sessionId) === live)
      await stopKimiCodeSession(input.sessionId);
    throw error;
  }
}

function emitConfig(live: Live): void {
  live.modelId = kimiModelOption(live.config)?.currentValue ?? live.modelId;
  if (!live.modelId) return;
  const settings = kimiSettings(live.config, live.modelId);
  live.onEvent({
    type: "session.configChanged",
    model: settings.model,
    modelSettings: Object.fromEntries(
      settings.settings.map((option) => [option.id, option.value]),
    ),
    modelSettingOptions: settings,
  });
}

async function setConfig(
  live: Live,
  option: ConfigOption,
  value: string,
): Promise<void> {
  if (option.currentValue === value) return;
  if (!option.options.some((choice) => choice.value === value))
    throw new Error(
      translate(
        "The selected Kimi Code setting is no longer available. Refresh the model list and retry.",
      ),
    );
  const result = await live.rpc.request(
    "session/set_config_option",
    { sessionId: live.providerId, configId: option.id, value },
    CONTROL_TIMEOUT,
  );
  if (Array.isArray(record(result).configOptions))
    live.config = kimiConfigOptions(record(result).configOptions);
  else option.currentValue = value;
}

async function configure(live: Live, input: SendTurnInput): Promise<void> {
  const model = input.model.replace(/^kimicode:/, "");
  const modelOption = kimiModelOption(live.config);
  if (model && model !== "default" && model !== live.modelId) {
    if (modelOption) await setConfig(live, modelOption, model);
    else
      await live.rpc.request(
        "session/set_model",
        { sessionId: live.providerId, modelId: model },
        CONTROL_TIMEOUT,
      );
    live.modelId = model;
  }
  if (live.cancelled) return;
  for (const [id, value] of Object.entries(input.modelSettings ?? {})) {
    const option = live.config.find(
      (item) =>
        item.id === id &&
        (item.category === "thought_level" || item.id === "thinking"),
    );
    if (option) await setConfig(live, option, value);
    if (live.cancelled) return;
  }
  const modeId = kimiMode(input);
  if (modeId !== live.modeId) {
    if (!live.modes.includes(modeId))
      throw new Error(
        translate(
          "This Kimi Code CLI does not support the selected permission mode. Update Kimi Code and retry.",
        ),
      );
    await live.rpc.request(
      "session/set_mode",
      { sessionId: live.providerId, modeId },
      CONTROL_TIMEOUT,
    );
    live.modeId = modeId;
  }
  emitConfig(live);
}

async function handleRequest(
  live: Live,
  wireId: JsonRpcId,
  method: string,
  params: unknown,
): Promise<void> {
  if (
    live.cancelled ||
    live.muted ||
    (record(params).sessionId != null &&
      record(params).sessionId !== live.providerId)
  ) {
    await live.rpc.respond(
      wireId,
      method === "elicitation/create"
        ? { action: "cancel" }
        : { outcome: { outcome: "cancelled" } },
    );
    return;
  }
  const question = kimiQuestion(method, params);
  // Request ids are opaque JSON-RPC values. The UI gets its own numeric id.
  const id = live.nextRequestId++;
  if (question) {
    const pending = new Promise<UserQuestionReply>((resolve) =>
      live.questions.set(id, resolve),
    );
    live.onEvent({
      type: "question.asked",
      requestId: id,
      title: question.title,
      questions: question.questions,
      callId: question.callId,
    });
    const reply = await pending;
    live.questions.delete(id);
    live.onEvent({
      type: "question.resolved",
      requestId: id,
      decision: live.cancelled ? "cancelled" : reply.kind,
      ...(reply.kind === "answered" ? { reply } : {}),
    });
    await live.rpc.respond(wireId, kimiQuestionResponse(question, reply));
    return;
  }
  if (method !== "session/request_permission") {
    await live.rpc.respondError(wireId, {
      code: -32601,
      message: `Method not found: ${method}`,
    });
    return;
  }
  const request = permissionRequestFromAcp(params);
  request.kind ??= kimiPermissionKind(params);
  let allow: boolean;
  if (live.planning)
    allow = ["read", "search", "think"].includes(request.kind ?? "");
  else if (
    live.runtimeMode === "full-access" ||
    (live.runtimeMode === "auto-accept-edits" &&
      ["edit", "read", "search"].includes(request.kind ?? ""))
  )
    allow = true;
  else {
    const pending = new Promise<ApprovalDecision>((resolve) =>
      live.approvals.set(id, resolve),
    );
    live.onEvent({
      type: "approval.requested",
      requestId: id,
      title: request.title,
      kind: request.kind,
      callId: request.callId,
      preview: request.preview,
    });
    const decision = await pending;
    live.approvals.delete(id);
    live.onEvent({
      type: "approval.resolved",
      requestId: id,
      decision: live.cancelled ? "cancelled" : decision,
    });
    allow = decision === "allow";
  }
  const optionId = kimiPermissionOption(params, allow);
  await live.rpc.respond(wireId, {
    outcome:
      !live.cancelled && optionId
        ? { outcome: "selected", optionId }
        : { outcome: "cancelled" },
  });
}

function resolveRequests(live: Live): void {
  for (const resolve of live.approvals.values()) resolve("deny");
  for (const resolve of live.questions.values()) resolve({ kind: "skipped" });
  live.approvals.clear();
  live.questions.clear();
}

export function respondKimiCodeApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  sessions.get(sessionId)?.approvals.get(requestId)?.(decision);
}
export function respondKimiCodeQuestion(
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  sessions.get(sessionId)?.questions.get(requestId)?.(reply);
}
export function bindKimiCodeSession(
  sessionId: string,
  providerId: string,
  cwd: string,
): void {
  if (sessionId && providerId.trim() && cwd.trim())
    resumes.set(sessionId, { providerId: providerId.trim(), cwd });
}
export async function cancelKimiCodeTurn(sessionId: string): Promise<void> {
  cancelled.add(sessionId);
  const live = sessions.get(sessionId);
  if (live) {
    live.cancelled = true;
    live.muted = true;
    resolveRequests(live);
    if (live.providerId)
      await live.rpc
        .notify("session/cancel", { sessionId: live.providerId })
        .catch(() => undefined);
  }
  // Recycle after cancellation so a late prompt response cannot overlap a new turn.
  await stopKimiCodeSession(sessionId);
}
export async function stopKimiCodeSession(sessionId: string): Promise<void> {
  const live = sessions.get(sessionId);
  sessions.delete(sessionId);
  if (live) {
    live.cancelled = true;
    live.muted = true;
    resolveRequests(live);
    resetGenerationMetrics(live.onEvent);
    live.rpc.close();
  }
  unwatchChild(sessionId);
  await killChild(sessionId).catch(() => undefined);
}
export async function forgetKimiCodeSession(sessionId: string): Promise<void> {
  resumes.delete(sessionId);
  await stopKimiCodeSession(sessionId);
  cancelled.delete(sessionId);
}
export async function readKimiCodeSessionTitle(
  input: NativeTitleInput,
): Promise<string | null> {
  const live = sessions.get(input.sessionId);
  if (live)
    return live.providerId === input.providerSessionId && live.cwd === input.cwd
      ? readAcpSessionTitle(live.rpc, input.providerSessionId, input.cwd).catch(
          () => null,
        )
      : null;
  const binary = await resolveKimiCodeBinary();
  return readAcpTitleInProcess(input, "kimicode", {
    path: binary.path,
    args: ["acp"],
  }).catch(() => null);
}

export async function discoverKimiCodeModels(
  cwd?: string,
): Promise<KimiModel[]> {
  const { path } = await resolveKimiCodeBinary();
  const directory =
    cwd ?? (await import("../../../../platform/tauri/fs")).homeDir();
  const probeId = `omnicode-kimi-probe-${crypto.randomUUID()}`;
  const rpc = new JsonRpcClient(probeId, {
    onRequest: (id, method) => {
      void rpc
        .respondError(id, {
          code: -32601,
          message: `Method not found: ${method}`,
        })
        .catch(() => undefined);
    },
  });
  let probeSessionId: string | undefined;
  let canDelete = false;
  watchChild(
    probeId,
    (line) => rpc.pushLine(line),
    () => rpc.close(),
  );
  try {
    await spawnChild(
      probeId,
      path,
      ["acp"],
      await directory,
      undefined,
      "kimicode",
    );
    const initialized = await rpc.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "omnicode", version: "0.1.0" },
      },
      CONTROL_TIMEOUT,
    );
    canDelete =
      record(record(record(initialized).agentCapabilities).sessionCapabilities)
        .delete != null;
    const setup = await rpc.request(
      "session/new",
      { cwd: await directory, mcpServers: [] },
      SESSION_TIMEOUT,
    );
    const id = record(setup).sessionId;
    if (typeof id === "string" && id) probeSessionId = id;
    return modelsFromKimiSession(setup);
  } finally {
    // Only remove the session this isolated probe just created, and only
    // through an advertised method. Catalog refresh must not leave empty chats.
    if (canDelete && probeSessionId) {
      await rpc
        .request(
          "session/delete",
          { sessionId: probeSessionId },
          CONTROL_TIMEOUT,
        )
        .catch(() => undefined);
    }
    rpc.close();
    unwatchChild(probeId);
    await killChild(probeId).catch(() => undefined);
  }
}
