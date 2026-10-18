import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalError, type Usage } from "./schema";
export const emptyUsage = (): Usage => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  models: [],
});
export class Budget {
  requests = 0;
  reservedUsd = 0;
  actualUsd = 0;
  constructor(
    public maxRequests: number,
    public maxUsd: number,
    public requestUsd: number,
  ) {
    if (
      !Number.isInteger(maxRequests) ||
      !Number.isFinite(maxUsd) ||
      !Number.isFinite(requestUsd) ||
      maxRequests < 1 ||
      maxUsd <= 0 ||
      requestUsd <= 0 ||
      requestUsd > maxUsd
    )
      throw new EvalError("INVALID_BUDGET");
  }
  reserve() {
    if (
      this.requests >= this.maxRequests ||
      this.actualUsd + this.requestUsd > this.maxUsd + 1e-9 ||
      this.reservedUsd + this.requestUsd > this.maxUsd + 1e-9
    )
      throw new EvalError("BUDGET_EXHAUSTED");
    this.requests++;
    this.reservedUsd += this.requestUsd;
  }
}
export function classifyError(text: string): string {
  if (/auth|login|credential|api.key|unauthorized|401/i.test(text))
    return "AUTH_UNAVAILABLE";
  if (/max.budget|request.budget|budget.exhaust/i.test(text))
    return "REQUEST_BUDGET";
  if (/credit.balance|insufficient.funds/i.test(text))
    return "CREDIT_UNAVAILABLE";
  if (
    /rate.limit|429|quota|usage.limit|weekly.limit|hit your.*limit/i.test(text)
  )
    return "RATE_LIMIT";
  if (/model.*not|model.*invalid|model.*unknown/i.test(text))
    return "MODEL_UNAVAILABLE";
  if (/ENOTFOUND|ECONN|network|fetch.failed|proxy|timed.out/i.test(text))
    return "NETWORK_ERROR";
  if (/ENOENT/i.test(text)) return "CLI_UNAVAILABLE";
  return "PROVIDER_ERROR";
}
export function runProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    });
    let out = "",
      err = "",
      settled = false;
    const stop = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        stop();
        reject(error);
      } else resolve(out);
    };
    const timer = setTimeout(() => finish(new EvalError("TIMEOUT")), timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 2_000_000) finish(new EvalError("OUTPUT_LIMIT"));
    });
    child.stderr.on("data", (chunk) => {
      err = (err + chunk).slice(-20000);
    });
    child.on("error", (e) => finish(new EvalError(classifyError(e.message))));
    child.on("close", (code) => {
      if (code !== 0) {
        try {
          const parsed = JSON.parse(out);
          if (parsed && typeof parsed === "object" && "is_error" in parsed) {
            finish();
            return;
          }
        } catch {}
        finish(new EvalError(classifyError(err + " " + out)));
      } else finish();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export function parseJSON(text: string): any {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(clean);
  } catch {
    throw new EvalError("INVALID_MODEL_OUTPUT");
  }
}
export type Completion = { text: string; usage: Usage };
export interface CompletionAdapter {
  model: string;
  complete(system: string, input: string): Promise<Completion>;
}

export class ClaudeAdapter {
  constructor(
    public model: string,
    public budget: Budget,
    public timeoutMs = 60000,
    public executable = "claude",
  ) {}
  async complete(system: string, input: string): Promise<Completion> {
    this.budget.reserve();
    const directory = await mkdtemp(join(tmpdir(), "monocode-eval-cli-"));
    const start = Date.now();
    try {
      const output = await runProcess(
        this.executable,
        [
          "--print",
          "--output-format",
          "json",
          "--model",
          this.model,
          "--effort",
          "low",
          "--tools",
          "",
          "--safe-mode",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--setting-sources",
          "",
          "--disable-slash-commands",
          "--no-chrome",
          "--no-session-persistence",
          "--permission-mode",
          "dontAsk",
          "--max-budget-usd",
          String(this.budget.requestUsd),
          "--system-prompt",
          system,
        ],
        input,
        directory,
        this.timeoutMs,
      );
      const result = parseJSON(output);
      const usage = emptyUsage();
      usage.requests = 1;
      usage.latencyMs = Date.now() - start;
      usage.inputTokens =
        (result.usage?.input_tokens ?? 0) +
        (result.usage?.cache_read_input_tokens ?? 0) +
        (result.usage?.cache_creation_input_tokens ?? 0);
      usage.outputTokens = result.usage?.output_tokens ?? 0;
      usage.costUsd =
        typeof result.total_cost_usd === "number"
          ? result.total_cost_usd
          : null;
      usage.models = Object.keys(result.modelUsage ?? {});
      if (usage.costUsd !== null) this.budget.actualUsd += usage.costUsd;
      if (result.is_error || (result.subtype && result.subtype !== "success")) {
        const error = new EvalError(
          classifyError(
            String(result.subtype ?? "") +
              " " +
              JSON.stringify(
                result.errors ?? result.error ?? result.result ?? "",
              ),
          ),
        ) as EvalError & { usage: Usage; providerSubtype: string };
        error.usage = usage;
        error.providerSubtype = String(result.subtype ?? "unknown");
        throw error;
      }
      if (typeof result.result !== "string")
        throw new EvalError("PROVIDER_PROTOCOL_ERROR");
      return { text: result.result, usage };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
export function addUsage(total: Usage, next: Usage) {
  total.requests += next.requests;
  total.inputTokens += next.inputTokens;
  total.outputTokens += next.outputTokens;
  total.latencyMs += next.latencyMs;
  total.costUsd =
    total.costUsd === null || next.costUsd === null
      ? null
      : total.costUsd + next.costUsd;
  total.models = [...new Set([...total.models, ...next.models])];
}

export class PiAdapter implements CompletionAdapter {
  constructor(
    public model: string,
    public budget: Budget,
    public timeoutMs = 60000,
  ) {}
  async complete(system: string, input: string): Promise<Completion> {
    this.budget.reserve();
    const directory = await mkdtemp(join(tmpdir(), "monocode-eval-pi-"));
    const started = Date.now();
    try {
      const output = await runProcess(
        "pi",
        [
          "--print",
          "--mode",
          "json",
          "--model",
          this.model,
          "--thinking",
          "low",
          "--no-tools",
          "--no-mcp",
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-context-files",
          "--no-themes",
          "--no-session",
          "--no-approve",
          "--offline",
          "--system-prompt",
          system,
        ],
        input,
        directory,
        this.timeoutMs,
      );
      const completion = parsePiOutput(output, Date.now() - started);
      if (completion.usage.costUsd !== null)
        this.budget.actualUsd += completion.usage.costUsd;
      return completion;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
export function parsePiOutput(output: string, latencyMs: number): Completion {
  const events = output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (events.some((e) => String(e.type).startsWith("tool_execution")))
    throw new EvalError("NATIVE_TOOL_VIOLATION");
  const messages = events
    .filter((e) => e.type === "message_end" && e.message?.role === "assistant")
    .map((e) => e.message);
  const last =
    messages.at(-1) ??
    events
      .findLast((e) => e.type === "agent_end")
      ?.messages?.findLast((m: any) => m.role === "assistant");
  if (!last) throw new EvalError(classifyError(output));
  const usage = emptyUsage();
  usage.requests = 1;
  usage.latencyMs = latencyMs;
  usage.inputTokens =
    (last.usage?.input ?? 0) +
    (last.usage?.cacheRead ?? 0) +
    (last.usage?.cacheWrite ?? 0);
  usage.outputTokens = last.usage?.output ?? 0;
  usage.costUsd =
    typeof last.usage?.cost?.total === "number" ? last.usage.cost.total : null;
  usage.models =
    typeof last.provider === "string" &&
    last.provider &&
    typeof last.model === "string" &&
    last.model
      ? [`${last.provider}/${last.model}`]
      : [];
  if (last.stopReason === "error" || last.errorMessage) {
    const error = new EvalError(
      classifyError(last.errorMessage ?? ""),
    ) as EvalError & { usage: Usage };
    error.usage = usage;
    throw error;
  }
  if (last.content?.some((x: any) => x.type === "toolCall"))
    throw new EvalError("NATIVE_TOOL_VIOLATION");
  return {
    text: (last.content ?? [])
      .filter((x: any) => x.type === "text")
      .map((x: any) => x.text)
      .join(""),
    usage,
  };
}
