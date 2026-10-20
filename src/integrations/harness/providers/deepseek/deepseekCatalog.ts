import { homeDir } from "../../../../platform/tauri/fs";
import { publishHarnessCatalog } from "../../core/registry";
import { deepseekModels } from "./deepseekProtocol";
import { readDeepseekRuntime } from "./deepseek";
import { parseDeepseekAccount, type DeepseekAccountClient } from "./deepseekAccount";

export async function discoverDeepseekModels(workingDirectory?: string) {
  return readDeepseekRuntime(workingDirectory ?? await homeDir(), async rpc =>
    deepseekModels(await rpc.request("models/list", {}, 30_000)));
}

export async function discoverDeepseekAccount(client: DeepseekAccountClient, workingDirectory?: string) {
  return readDeepseekRuntime(workingDirectory ?? await homeDir(), async rpc => parseDeepseekAccount(
    await rpc.request("account/read", { client }, 30_000),
  ));
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
