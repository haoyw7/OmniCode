// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createPersistedPreferences } from "./persistedPreferences";

const cleanups: Array<() => void> = [];
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  const prefs = createPersistedPreferences(storage);
  cleanups.push(prefs.dispose);
  return { values, storage, prefs };
}
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); });

it("can persist in a non-DOM environment without installing browser listeners", () => {
  vi.stubGlobal("window", {});
  const { values, prefs } = fixture();
  prefs.setItem("flag", "1");
  expect(values.get("flag")).toBe("1");
  expect(prefs.getItem("flag")).toBe("1");
});

it("hydrates legacy raw values, persists without an envelope, and removes the original key", () => {
  const { values, storage, prefs } = fixture();
  values.set("flag", "1");
  expect(prefs.store("flag").getState().value).toBe("1");
  expect(storage.setItem).not.toHaveBeenCalled();
  prefs.setItem("flag", "0");
  expect(values.get("flag")).toBe("0");
  expect([...values.keys()]).toEqual(["flag"]);
  prefs.removeItem("flag");
  expect(values.size).toBe(0);
  expect(prefs.getItem("flag")).toBeNull();
});

it("updates only the changed key and never writes back an external storage event", () => {
  const { values, storage, prefs } = fixture();
  const changed = vi.fn();
  prefs.subscribe(["theme"], changed);
  prefs.setItem("other", "x");
  expect(changed).not.toHaveBeenCalled();
  values.set("theme", "dark");
  storage.setItem.mockClear();
  window.dispatchEvent(new StorageEvent("storage", { key: "theme" }));
  expect(prefs.store("theme").getState().value).toBe("dark");
  expect(changed).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent("storage", { key: "theme" }));
  expect(changed).toHaveBeenCalledTimes(1);
  values.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(prefs.getItem("theme")).toBeNull();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("refreshes a new Host through its adapter without echoing values into its journal", () => {
  const { values, storage, prefs } = fixture();
  values.set("theme", "dark");
  const store = prefs.store("theme");
  const changed = vi.fn();
  prefs.subscribe(["theme"], changed);
  values.set("theme", "light");
  prefs.refresh();
  expect(store.getState().value).toBe("light");
  expect(changed).toHaveBeenCalledOnce();
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("rolls back a failed durable edit while explicitly optional preferences remain usable", () => {
  const { values, storage, prefs } = fixture();
  values.set("theme", "dark");
  const changed = vi.fn();
  prefs.subscribe(["theme"], changed);
  storage.setItem.mockImplementation(() => { throw new Error("quota"); });
  expect(() => prefs.setItem("theme", "light")).toThrow("quota");
  expect(prefs.getItem("theme")).toBe("dark");
  expect(changed).not.toHaveBeenCalled();
  expect(() => prefs.setItem("mask", "1", true)).toThrow("quota");
  expect(prefs.getItem("mask")).toBe("1");
  // A verified source change wins over an unsaved choice in the previous context.
  prefs.refresh();
  expect(prefs.getItem("mask")).toBeNull();
});

it("keeps subscribers on the pending value during a synchronous Host announcement", () => {
  const { storage, prefs, values } = fixture();
  const observed: Array<string | null> = [];
  prefs.subscribe(["theme"], () => {
    expect(values.get("theme")).toBe("light");
    observed.push(prefs.getItem("theme"));
  });
  const write = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementation((key, value) => {
    write(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  prefs.setItem("theme", "light");
  expect(observed).toEqual(["light"]);
});

it("does not notify after disposal and keeps read failures visible to domain defaults", () => {
  const { values, storage, prefs } = fixture();
  const changed = vi.fn();
  prefs.subscribe(["theme"], changed);
  prefs.dispose();
  values.set("theme", "light");
  window.dispatchEvent(new StorageEvent("storage", { key: "theme" }));
  expect(changed).not.toHaveBeenCalled();
  storage.getItem.mockImplementation(() => { throw new Error("unavailable"); });
  expect(() => prefs.getItem("theme")).toThrow("unavailable");
});

it("keeps the latest reentrant edit and persists each logical write exactly once", () => {
  const { values, storage, prefs } = fixture();
  prefs.subscribe(["theme"], () => {
    if (prefs.getItem("theme") === "light") prefs.setItem("theme", "dark");
  });
  prefs.setItem("theme", "light");
  expect(prefs.getItem("theme")).toBe("dark");
  expect(values.get("theme")).toBe("dark");
  expect(storage.setItem.mock.calls).toEqual([["theme", "light"], ["theme", "dark"]]);
});

it("does not overwrite a newer edit made during the Host announcement", () => {
  const { values, storage, prefs } = fixture();
  const write = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementation((key, value) => {
    write(key, value);
    if (value === "light") prefs.setItem(key, "dark");
  });
  const changed = vi.fn(() => expect(prefs.getItem("theme")).toBe("dark"));
  prefs.subscribe(["theme"], changed);
  prefs.setItem("theme", "light");
  expect(prefs.store("theme").getState().value).toBe("dark");
  expect(values.get("theme")).toBe("dark");
  expect(changed).toHaveBeenCalledOnce();
});
