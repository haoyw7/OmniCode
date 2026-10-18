import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_SKIN_DEFAULT,
  DESKTOP_SKIN_IDS,
  DESKTOP_SKIN_KEY,
  applyDesktopSkin,
  loadDesktopSkin,
  normalizeDesktopSkin,
  resolveDesktopSkin,
  saveDesktopSkin,
} from "./desktopSkin";

describe("desktop skin preference", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("defaults unknown values to auto", () => {
    expect(DESKTOP_SKIN_DEFAULT).toBe("auto");
    expect(normalizeDesktopSkin(null)).toBe("auto");
    expect(normalizeDesktopSkin("solarized")).toBe("auto");
    expect(normalizeDesktopSkin("midnight")).toBe("midnight");
    expect(normalizeDesktopSkin("classic")).toBe("classic");
  });

  it("uses the default pair for automatic mode and preserves named palettes", () => {
    expect(resolveDesktopSkin("auto", false)).toBe("midnight");
    expect(resolveDesktopSkin("auto", true)).toBe("daylight");
    expect(resolveDesktopSkin("classic", true)).toBe("daylight");
    for (const skin of DESKTOP_SKIN_IDS) {
      expect(resolveDesktopSkin(skin, true)).toBe(skin);
      expect(resolveDesktopSkin(skin, false)).toBe(skin);
    }
  });

  it("persists a named skin and ignores a broken store", () => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
      },
    });
    saveDesktopSkin("lagoon");
    expect(data.get(DESKTOP_SKIN_KEY)).toBe("lagoon");
    expect(loadDesktopSkin()).toBe("lagoon");
    data.set(DESKTOP_SKIN_KEY, "nope");
    expect(loadDesktopSkin()).toBe("auto");
  });

  it("stamps data-skin and follows the skin's scheme", () => {
    const classNames = new Set<string>(["theme-light"]);
    const dataset: { skin?: string; desktopVisual?: string } = {};
    const style: { colorScheme: string } = { colorScheme: "" };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: {
          dataset,
          style,
          classList: {
            contains: (name: string) => classNames.has(name),
            toggle: (name: string, on: boolean) => {
              if (on) classNames.add(name);
              else classNames.delete(name);
            },
          },
        },
      },
    });
    expect(applyDesktopSkin("meadow")).toBe("light");
    expect(dataset.skin).toBe("meadow");
    expect(dataset.desktopVisual).toBe("claude-measured-v1");
    expect(classNames.has("theme-light")).toBe(true);
    expect(style.colorScheme).toBe("light");

    expect(applyDesktopSkin("classic")).toBe("light");
    expect(dataset.skin).toBe("daylight");
    expect(style.colorScheme).toBe("light");
  });
});
