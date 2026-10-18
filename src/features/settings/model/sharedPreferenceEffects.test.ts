// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initAppearance = vi.hoisted(() => vi.fn());
vi.mock("./appearance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./appearance")>()),
  initAppearance,
}));

import { installSharedPreferenceEffects } from "./sharedPreferenceEffects";
import { SHARED_PREFERENCES_CHANGED } from "./sharedPreferences";

const announce = (detail?: string[]) =>
  window.dispatchEvent(new CustomEvent(SHARED_PREFERENCES_CHANGED, { detail }));

let uninstall: () => void;
beforeEach(() => {
  initAppearance.mockClear();
  uninstall = installSharedPreferenceEffects();
});
afterEach(() => uninstall());

describe("shared preference effects", () => {
  it("does not replay appearance for sidebar navigation state", () => {
    announce(["monocode.projectRailOrder"]);
    announce(["monocode.recentProjects", "monocode.sessionSidebarOrder.v1"]);
    announce(['monocode.sessionFolders::["/repo"]']);
    expect(initAppearance).not.toHaveBeenCalled();
  });

  it("replays appearance when a presentation key or unknown set changes", () => {
    announce(["monocode.recentProjects", "monocode.themeHue"]);
    announce();
    expect(initAppearance).toHaveBeenCalledTimes(2);
  });
});
