// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSkillCatalog } from "../features/connections/model/protocol";
import { useMobileSkills, type MobileSkillsLoader } from "./useMobileSkills";

const catalog: HostSkillCatalog = {
  native: false,
  canCompact: true,
  skills: [{
    kind: "file", name: "review", invocation: "review", description: "Review",
    path: "/project/.agents/skills/review/SKILL.md", scope: "project", source: "agents",
  }],
};
let root: Root, node: HTMLDivElement, key: string;
let nextKey = 0;
let state: ReturnType<typeof useMobileSkills>;
let renders: typeof state[];
let load: ReturnType<typeof vi.fn<MobileSkillsLoader>>;

function Fixture(props: { context: string; open: boolean; native: boolean }) {
  state = useMobileSkills(props.context, load, props.open, props.native);
  renders.push(state);
  return null;
}
async function render(open: boolean, context = key, native = false) {
  await act(async () => root.render(createElement(Fixture, { context, open, native })));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  key = `skills-cache:${++nextKey}`;
  renders = [];
  load = vi.fn(async () => catalog);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mobile skills cache", () => {
  it("loads on demand, shares an in-flight reopen and reuses the resolved catalog", async () => {
    const pending = deferred<HostSkillCatalog>();
    load.mockReturnValue(pending.promise);
    await render(false);
    expect(load).not.toHaveBeenCalled();
    await render(true);
    expect(state.loading).toBe(true);
    await render(false);
    await render(true);
    expect(load).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(catalog));
    expect(state.catalog).toBe(catalog);
    expect(state.loading).toBe(false);
    await render(false);
    await render(true);
    expect(load).toHaveBeenCalledOnce();
    expect(state.catalog).toBe(catalog);
  });

  it("renders cached skills immediately after remounting the composer", async () => {
    await render(true);
    await act(async () => root.render(null));
    renders = [];
    await render(true);
    expect(renders[0].catalog).toBe(catalog);
    expect(renders.every(value => !value.loading)).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  it("isolates contexts and restores the cached list when returning to one", async () => {
    await render(true);
    const other: HostSkillCatalog = { native: true, canCompact: false, skills: [] };
    load.mockResolvedValueOnce(other);
    renders = [];
    await render(true, `${key}:other`, true);
    expect(renders[0].catalog).toBeUndefined();
    expect(state.catalog).toBe(other);
    renders = [];
    await render(true);
    expect(renders[0].catalog).toBe(catalog);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    { native: false, ttl: 300_000, refresh: true },
    { native: true, ttl: 30_000, refresh: false },
  ])("refreshes expired native=$native catalogs without hiding their rows", async ({ native, ttl, refresh }) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const initial = { ...catalog, native };
    load.mockResolvedValueOnce(initial);
    await render(true, key, native);
    await render(false, key, native);
    now.mockReturnValue(1000 + ttl - 1);
    await render(true, key, native);
    expect(load).toHaveBeenCalledOnce();
    await render(false, key, native);
    now.mockReturnValue(1000 + ttl);
    const pending = deferred<HostSkillCatalog>();
    load.mockReturnValueOnce(pending.promise);
    renders = [];
    await render(true, key, native);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(refresh);
    expect(state.catalog).toBe(initial);
    expect(renders.every(value => !value.loading)).toBe(true);
    const updated = { ...initial, canCompact: false, skills: [] };
    await act(async () => pending.resolve(updated));
    expect(state.catalog).toBe(updated);
  });

  it("keeps a successful empty list cached and honors explicit refresh", async () => {
    const empty = { native: true, canCompact: false, skills: [] };
    load.mockResolvedValueOnce(empty);
    await render(true, key, true);
    await render(false, key, true);
    await render(true, key, true);
    expect(load).toHaveBeenCalledOnce();
    load.mockResolvedValueOnce({ ...catalog, native: true });
    await act(async () => state.reload(true));
    expect(load).toHaveBeenLastCalledWith(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(state.catalog?.skills).toEqual(catalog.skills);
  });

  it("retains cached skills after a failed refresh and lets Retry recover", async () => {
    await render(true);
    load.mockRejectedValueOnce(new Error("Host offline"));
    await act(async () => state.reload(true));
    expect(state.catalog).toBe(catalog);
    expect(state.loading).toBe(false);
    expect(state.failed).toBe(true);
    expect(state.error).toBe("Host offline");
    const updated = { ...catalog, skills: [] };
    load.mockResolvedValueOnce(updated);
    await act(async () => state.reload(true));
    expect(state.failed).toBeUndefined();
    expect(state.catalog).toBe(updated);
  });

  it("ignores a late response in another context and caches it for returning", async () => {
    const pending = deferred<HostSkillCatalog>();
    load.mockReturnValueOnce(pending.promise);
    await render(true);
    const other = { native: false, canCompact: false, skills: [] };
    load.mockResolvedValueOnce(other);
    await render(true, `${key}:other`);
    await act(async () => pending.resolve(catalog));
    expect(state.catalog).toBe(other);
    await render(true);
    expect(state.catalog).toBe(catalog);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
