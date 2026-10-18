import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_TITLE_MODEL,
  type TitleModelStatus,
} from "../src/features/sessions/model/titleModel";
import {
  buildThreadTitlePrompt,
  parseGeneratedSessionTitle,
  type GeneratedSessionTitle,
} from "../src/features/sessions/model/sessionTitle";
import { buildBranchNamePrompt, parseBranchName } from "../src/features/source-control/model/gitText";

type Config = Omit<TitleModelStatus, "hasApiKey"> & { apiKey: string };
const MAX_RESPONSE_BYTES = 256 * 1024;

function endpoint(value: unknown): string {
  try {
    if (typeof value !== "string") throw new Error();
    const url = new URL(value.trim());
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      throw new Error();
    return url.href;
  } catch {
    throw new Error(
      "Use an HTTPS endpoint or HTTP on localhost, without credentials, query parameters or fragments.",
    );
  }
}

function config(value: unknown, previous?: Config): Config {
  if (!value || typeof value !== "object")
    throw new Error("Invalid title model settings.");
  const input = value as Record<string, unknown>;
  if (
    typeof input.enabled !== "boolean" ||
    typeof input.model !== "string" ||
    (input.apiKey !== undefined && typeof input.apiKey !== "string")
  )
    throw new Error("Invalid title model settings.");
  const url = endpoint(input.endpoint);
  const model = input.model.trim();
  if (model.length > 256 || (input.enabled && !model))
    throw new Error("Enter a model ID for title generation.");
  // Changing destinations must never silently forward a previously saved secret.
  if (
    previous?.apiKey &&
    previous.endpoint !== url &&
    input.apiKey === undefined
  )
    throw new Error(
      "Re-enter or clear the API key when changing the endpoint.",
    );
  const apiKey =
    input.apiKey === undefined
      ? (previous?.apiKey ?? "")
      : (input.apiKey as string).trim();
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey))
    throw new Error("Invalid API key.");
  return { enabled: input.enabled, endpoint: url, model, apiKey };
}

/** Direct model requests owned by the Host; never launches a provider or creates a chat. */
export class TitleModelApi {
  private readonly path: string;
  constructor(private readonly directory: string) {
    this.path = join(directory, "title-model.json");
  }

  private read(): Config {
    try {
      return config(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const { hasApiKey: _, ...defaults } = DEFAULT_TITLE_MODEL;
        return { ...defaults, apiKey: "" };
      }
      throw new Error("Could not read title model settings.");
    }
  }

  status(): TitleModelStatus {
    const { apiKey, ...settings } = this.read();
    return { ...settings, hasApiKey: !!apiKey };
  }

  save(input: unknown): TitleModelStatus {
    const next = config(input, this.read());
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(next), {
        mode: 0o600,
        flag: "wx",
      });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    return this.status();
  }

  async generate(message: string): Promise<GeneratedSessionTitle | null> {
    return this.request(message, buildThreadTitlePrompt(message), (output) =>
      parseGeneratedSessionTitle(output, message),
    );
  }

  async generateBranch(message: string): Promise<string | null> {
    return this.request(message, buildBranchNamePrompt(message), parseBranchName);
  }

  private async request<T>(
    message: string,
    prompt: string,
    parse: (output: string) => T | null,
  ): Promise<T | null> {
    const settings = this.read();
    if (!settings.enabled || !message.trim()) return null;
    let response: Response;
    try {
      response = await fetch(settings.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.apiKey
            ? { Authorization: `Bearer ${settings.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "user", content: prompt },
          ],
          stream: false,
          store: false,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("Title model request failed or timed out.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Title model returned HTTP ${response.status}.`);
    }
    let data: {
      choices?: {
        message?: {
          content?: unknown;
          tool_calls?: unknown;
          refusal?: unknown;
        };
        finish_reason?: string;
      }[];
    };
    try {
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Title model returned an invalid response.");
    }
    const choice = data?.choices?.[0];
    const calls = choice?.message?.tool_calls;
    if (
      choice?.finish_reason === "length" ||
      choice?.message?.refusal ||
      (Array.isArray(calls) ? calls.length > 0 : calls != null) ||
      typeof choice?.message?.content !== "string"
    )
      throw new Error("Title model did not return a title.");
    const title = parse(choice.message.content);
    if (!title) throw new Error("Title model did not return a title.");
    // Discard completions from credentials/settings that changed while awaiting the model.
    return JSON.stringify(this.read()) === JSON.stringify(settings)
      ? title
      : null;
  }
}
