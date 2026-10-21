// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { activatePreferenceStore, preferenceStorage, SharedPreferenceStore, type PreferenceSnapshot } from "./sharedPreferences";

const key = "omnicode.colorScheme";
afterEach(() => { activatePreferenceStore(undefined); localStorage.clear(); preferenceStorage.refresh(); });

it("hydrates the selected Host without upload and journals an edit before publishing it", async () => {
  let server: PreferenceSnapshot = { revision: 1, imported: true, values: { [key]: "dark" } };
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "preferences.patch") {
      server = { ...server, revision: server.revision + 1, values: { ...server.values, ...params.changes as Record<string, string> } };
    }
    return server;
  });
  const host = new SharedPreferenceStore("first", localStorage, async <T,>(method: string, params: Record<string, unknown>) => await request(method, params) as T);
  await host.sync();
  activatePreferenceStore(host);
  expect(preferenceStorage.store(key).getState().value).toBe("dark");
  expect(request.mock.calls.filter(([method]) => method === "preferences.patch")).toHaveLength(0);
  const observed = vi.fn(() => {
    expect(host.pendingCount).toBe(1);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).some(name => name?.startsWith(host.journalPrefix))).toBe(true);
    expect(preferenceStorage.getItem(key)).toBe("light");
  });
  const stop = preferenceStorage.subscribe([key], observed);
  preferenceStorage.setItem(key, "light");
  expect(observed).toHaveBeenCalledOnce();
  stop();
  await host.sync();
  expect(request.mock.calls.filter(([method]) => method === "preferences.patch")).toHaveLength(1);
  const second = new SharedPreferenceStore("second", localStorage, async <T,>() => ({ revision: 1, imported: true, values: {} }) as T);
  await second.sync();
  activatePreferenceStore(second);
  expect(preferenceStorage.store(key).getState().value).toBeNull();
  expect(second.pendingCount).toBe(0);
});
