import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GLASS_SETTINGS,
  GLASS_SETTINGS_KEY,
  glassVariables,
  normalizeGlassSettings,
  readGlassSettings,
  saveGlassSettings,
} from "./glassSettings";

function installStorage(initial: Record<string, string> = {}, fail = false) {
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => {
        if (fail) throw new Error("blocked");
        return values.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (fail) throw new Error("blocked");
        values.set(key, value);
      },
    },
  });
  return values;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("mobile glass settings", () => {
  it("keeps valid values and repairs invalid ones", () => {
    expect(
      normalizeGlassSettings({ effect: "frosted", intensity: 130, transparency: -4.6 }),
    ).toEqual({ effect: "frosted", intensity: 100, transparency: 0 });
    expect(normalizeGlassSettings({ effect: "neon", intensity: "50" })).toEqual(
      DEFAULT_GLASS_SETTINGS,
    );
    expect(normalizeGlassSettings(null)).toEqual(DEFAULT_GLASS_SETTINGS);
  });

  it("persists settings and survives broken or blocked storage", () => {
    const values = installStorage();
    saveGlassSettings({ effect: "solid", intensity: 20, transparency: 40 });
    expect(JSON.parse(values.get(GLASS_SETTINGS_KEY)!)).toEqual({
      effect: "solid",
      intensity: 20,
      transparency: 40,
    });
    expect(readGlassSettings()).toEqual({
      effect: "solid",
      intensity: 20,
      transparency: 40,
    });

    installStorage({ [GLASS_SETTINGS_KEY]: "{not json" });
    expect(readGlassSettings()).toEqual(DEFAULT_GLASS_SETTINGS);

    installStorage({}, true);
    expect(readGlassSettings()).toEqual(DEFAULT_GLASS_SETTINGS);
    expect(() => saveGlassSettings(DEFAULT_GLASS_SETTINGS)).not.toThrow();
  });

  it("keeps saved Liquid glass as Frosted", () => {
    expect(normalizeGlassSettings({ effect: "liquid", intensity: 30, transparency: 60 })).toEqual({
      effect: "frosted",
      intensity: 30,
      transparency: 60,
    });
  });

  it("maps transparency to a lighter fill for controls than for panels", () => {
    const vars = glassVariables({ effect: "frosted", intensity: 50, transparency: 78 });
    expect(vars["--m-material-fill"]).toBe("22%");
    expect(vars["--m-material-panel-fill"]).toBe("57.1%");
    expect(
      glassVariables({ effect: "frosted", intensity: 50, transparency: 100 })[
        "--m-material-fill"
      ],
    ).toBe("0%");
  });

  it("scales blur and saturation with intensity, and drops both when solid", () => {
    const frosted = glassVariables({ effect: "frosted", intensity: 50, transparency: 22 });
    expect(frosted["--m-material-blur"]).toBe("20px");
    expect(frosted["--m-material-saturate"]).toBe("140%");
    expect(glassVariables({ effect: "frosted", intensity: 100, transparency: 22 })["--m-material-blur"]).toBe("36px");
    const solid = glassVariables({ effect: "solid", intensity: 100, transparency: 100 });
    expect(solid["--m-material-fill"]).toBe("100%");
    expect(solid["--m-material-panel-fill"]).toBe("100%");
    expect(solid["--m-material-blur"]).toBe("0px");
    expect(solid["--m-material-saturate"]).toBe("100%");
  });
});
