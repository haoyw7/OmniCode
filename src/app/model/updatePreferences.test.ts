// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadUpdatePreferences,
  saveUpdatePreferences,
} from "./updatePreferences";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it("defaults to manual installation and preserves unrelated update choices", () => {
  expect(loadUpdatePreferences()).toEqual({
    autoInstall: false,
    skippedVersion: null,
  });
  saveUpdatePreferences({ skippedVersion: "0.7.1" });
  saveUpdatePreferences({ autoInstall: true });
  expect(loadUpdatePreferences()).toEqual({
    autoInstall: true,
    skippedVersion: "0.7.1",
  });
});

it.each(['{"autoInstall":"true","skippedVersion":7}', "not json", "null"])(
  "does not enable automatic installation from corrupt preferences %s",
  (raw) => {
    localStorage.setItem("monocode.updatePreferences", raw);
    expect(loadUpdatePreferences()).toEqual({
      autoInstall: false,
      skippedVersion: null,
    });
  },
);

it("tolerates unavailable storage", () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });
  expect(() => saveUpdatePreferences({ autoInstall: true })).not.toThrow();
  expect(loadUpdatePreferences().autoInstall).toBe(false);
});
