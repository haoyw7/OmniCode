import { killChild, spawnChild, unwatchChild, watchChild } from "../../core/child";
import { JsonRpcClient } from "../../core/jsonRpc";

const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

/** A short-lived account request, shared by desktop and Host process backends. */
export async function runCodexAccountRequest<T>(
  path: string,
  cwd: string,
  method: string,
  params: unknown,
  accountId: string,
  childId = "omnicode-codex-usage",
): Promise<T> {
  const rpc = new JsonRpcClient(
    childId,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: "codex-usage" },
  );

  const stop = async () => {
    rpc.close();
    unwatchChild(childId);
    await killChild(childId).catch(() => undefined);
  };

  await killChild(childId).catch(() => undefined);

  watchChild(
    childId,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex usage probe exited")),
  );

  try {
    await spawnChild(
      childId,
      path,
      ["app-server"],
      cwd,
      {
        provider: "codex",
        id: accountId,
      },
      "codex",
    );
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        await rpc.request(
          "initialize",
          {
            clientInfo: {
              name: "omnicode",
              title: "OmniCode",
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true },
          },
          REQUEST_TIMEOUT_MS,
        );
        await rpc.notify("initialized", undefined);

        return rpc.request<T>(method, params, REQUEST_TIMEOUT_MS);
      },
      () => {
        void stop();
      },
    );
  } finally {
    await stop();
  }
}

async function withTimeout<T>(
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = work();
  try {
    return await Promise.race([
      pending,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error("Codex usage probe timed out"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void pending.catch(() => undefined);
  }
}
