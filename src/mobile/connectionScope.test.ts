// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { loadMobileAgentDefaults, saveMobileAgentDefaults } from "./agentDefaults";
import { saveConnectionAppearance } from "./connectionAppearance";
import { migrateConnectionSettings } from "./connectionScope";

afterEach(() => localStorage.clear());

it("moves settings saved by Host identity to the connection address once", () => {
  saveMobileAgentDefaults("host-a", { harness: "claude", agents: {} });
  saveMobileAgentDefaults("http://10.0.0.2:3774", { harness: "codex", agents: {} });
  saveConnectionAppearance("host-a", { displayName: "Workstation", icon: "terminal" });

  migrateConnectionSettings([
    { endpoint: "http://10.0.0.1:3774", environmentId: "host-a" },
    { endpoint: "http://100.64.0.1:3774", environmentId: "host-a" },
    { endpoint: "http://10.0.0.2:3774", environmentId: "host-b" },
  ]);

  expect(loadMobileAgentDefaults("http://10.0.0.1:3774").harness).toBe("claude");
  expect(loadMobileAgentDefaults("http://100.64.0.1:3774")).toEqual({});
  expect(loadMobileAgentDefaults("http://10.0.0.2:3774").harness).toBe("codex");
  expect(loadMobileAgentDefaults("host-a")).toEqual({});
  expect(localStorage.getItem("monocode.mobile.connectionAppearance:host-a")).toBeNull();
  expect(JSON.parse(localStorage.getItem("monocode.mobile.connectionAppearance:http://10.0.0.1:3774")!))
    .toEqual({ displayName: "Workstation", icon: "terminal" });
});
