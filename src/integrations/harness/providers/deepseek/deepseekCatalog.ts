import { homeDir } from "../../../../platform/tauri/fs";
import { JsonRpcClient } from "../../core/jsonRpc";
import {
  killChild,
  prepareDeepseekBridge,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import { publishHarnessCatalog } from "../../core/registry";
import {
  DEEPSEEK_BRIDGE_PROTOCOL,
  DEEPSEEK_RUNTIME_VERSION,
  deepseekModels,
  asRecord,
} from "./deepseekProtocol";
import { translate } from "../../../../shared/i18n/language";
import { parseDeepseekAccount, type DeepseekAccountClient } from "./deepseekAccount";

async function queryDeepseek<T>(
  read: (rpc: JsonRpcClient, initialized: ReturnType<typeof asRecord>) => Promise<T>,
  workingDirectory?: string,
  includeCatalog = true,
) {
  const cwd = workingDirectory ?? (await homeDir());
  const launch = await prepareDeepseekBridge(cwd);
  const id = `omnicode-deepseek-catalog-${crypto.randomUUID()}`;
  const rpc = new JsonRpcClient(id, {});
  watchChild(
    id,
    (line) => rpc.pushLine(line),
    () => rpc.close(),
  );
  try {
    await spawnChild(id, launch.path, launch.args, cwd, undefined, "deepseek");
    const initialized = asRecord(
      await rpc.request(
        "initialize",
        { protocolVersion: DEEPSEEK_BRIDGE_PROTOCOL, includeCatalog },
        60_000,
      ),
    );
    if (
      initialized.protocolVersion !== DEEPSEEK_BRIDGE_PROTOCOL ||
      initialized.runtimeVersion !== DEEPSEEK_RUNTIME_VERSION
    )
      throw new Error(translate("Unsupported DeepSeek Harness bridge version"));
    return await read(rpc, initialized);
  } finally {
    await rpc.request("shutdown", {}, 5_000).catch(() => {});
    rpc.close();
    unwatchChild(id);
    await killChild(id).catch(() => {});
  }
}

export function discoverDeepseekModels(workingDirectory?: string) {
  return queryDeepseek(async (_rpc, initialized) => deepseekModels(initialized.catalog), workingDirectory);
}

export function discoverDeepseekAccount(client: DeepseekAccountClient) {
  return queryDeepseek(async rpc => parseDeepseekAccount(
    await rpc.request("account/read", { client }, 30_000),
  ), undefined, false);
}

let refreshing: Promise<void> | undefined;
export function refreshDeepseekCatalog(): Promise<void> {
  refreshing ??= discoverDeepseekModels()
    .then((models) => publishHarnessCatalog("deepseek", models))
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}
