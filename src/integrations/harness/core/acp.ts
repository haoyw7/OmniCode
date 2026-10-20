import {
  JsonRpcClient,
  type JsonRpcHandlers,
  type JsonRpcId,
  type JsonRpcMessage,
} from "./jsonRpc";
import { translate } from "../../../shared/i18n/language";

export type { JsonRpcMessage };

export type AcpHandlers = {
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (
    id: number,
    method: string,
    params: unknown,
  ) => void | Promise<void>;
};

/** ACP JSON-RPC client — thin wrapper preserving the Cursor numeric-id API. */
export class AcpClient {
  private readonly rpc: JsonRpcClient;

  constructor(
    sessionId: string,
    private readonly handlers: AcpHandlers,
  ) {
    const rpcHandlers: JsonRpcHandlers = {
      onNotification: (method, params) =>
        this.handlers.onNotification?.(method, params),
      onRequest: (id, method, params) => {
        const numeric =
          typeof id === "number" ? id : Number(id);
        void this.handlers.onRequest?.(numeric, method, params);
      },
    };
    this.rpc = new JsonRpcClient(sessionId, rpcHandlers, {
      includeJsonrpc: true,
      label: "acp",
    });
  }

  pushLine(line: string) {
    this.rpc.pushLine(line);
  }

  close(error?: Error) {
    this.rpc.close(error);
  }

  rejectPending(error?: Error) {
    this.rpc.rejectPending(error);
  }

  request<T>(method: string, params?: unknown, timeoutMs = 0): Promise<T> {
    return this.rpc.request<T>(method, params, timeoutMs);
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.rpc.notify(method, params);
  }

  respond(id: number, result: unknown): Promise<void> {
    return this.rpc.respond(id as JsonRpcId, result);
  }

  respondError(
    id: number,
    error: { code: number; message: string; data?: unknown },
  ): Promise<void> {
    return this.rpc.respondError(id as JsonRpcId, error);
  }
}

/** ACP v1 can report an incomplete turn in a successful RPC response. */
export function assertAcpPromptCompleted(result: unknown): void {
  if (!result || typeof result !== "object") return;
  const reason = (result as { stopReason?: unknown }).stopReason;
  // Cancellation, missing reasons and unknown extensions retain their own semantics.
  if (reason === "max_tokens")
    throw new Error(translate("The agent reached the output token limit before completing the turn."));
  if (reason === "max_turn_requests")
    throw new Error(translate("The agent reached the request limit before completing the turn."));
  if (reason === "refusal")
    throw new Error(translate("The agent refused to continue this turn."));
}
