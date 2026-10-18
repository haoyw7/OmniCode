import type { Connection } from "./client";
import { moveMobileAgentDefaults } from "./agentDefaults";
import { moveConnectionAppearance } from "./connectionAppearance";

/**
 * Paired connections are distinguished by address, so one Host reached through
 * several addresses keeps separate entries and settings. Settings saved before
 * this were keyed by Host identity, which matched a single entry; move them.
 */
export function migrateConnectionSettings(connections: readonly Pick<Connection, "endpoint" | "environmentId">[]) {
  for (const { endpoint, environmentId } of connections) {
    if (!environmentId || environmentId === endpoint) continue;
    moveMobileAgentDefaults(environmentId, endpoint);
    moveConnectionAppearance(environmentId, endpoint);
  }
}
