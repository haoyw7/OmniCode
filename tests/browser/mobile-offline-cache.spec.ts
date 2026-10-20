import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/mobile-offline-cache.html");
});

test("persists LRU order across a page restart, with independent Host and model budgets", async ({ page }) => {
  await page.evaluate(async () => {
    const module = "/src/mobile/offlineCache.ts";
    const { IndexedDbMobileOfflineCache } = await import(module);
    const cache = new IndexedDbMobileOfflineCache("lru-test");
    await cache.write("a", Array.from({ length: 12 }, (_, i) => ({ kind: "session", id: `${i}`, value: { text: `message ${i}` } })));
    await cache.write("a", [{ kind: "session", id: "0" }]);
    await cache.write("b", [{ kind: "session", id: "0", value: { text: "Other computer" } }]);
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const module = "/src/mobile/offlineCache.ts";
    const { IndexedDbMobileOfflineCache } = await import(module);
    const cache = new IndexedDbMobileOfflineCache("lru-test");
    await cache.write("a", [{ kind: "session", id: "12", value: { text: "Newest" } }]);
    await cache.write("a", Array.from({ length: 9 }, (_, i) => ({ kind: "models", id: `${i}`, value: { models: {} } })));
    return { a: await cache.readHost("a"), b: await cache.readHost("b") };
  });
  expect(result.a.filter(row => row.kind === "session").map(row => row.id)).toEqual(["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "0", "12"]);
  expect(result.a.filter(row => row.kind === "models").map(row => row.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  expect(result.b[0].value.text).toBe("Other computer");
});

test("bounds total bytes and removes all records for a forgotten Host", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const module = "/src/mobile/offlineCache.ts";
    const { IndexedDbMobileOfflineCache } = await import(module);
    const cache = new IndexedDbMobileOfflineCache("budget-test", 600);
    await cache.write("a", [{ kind: "session", id: "old", value: "a".repeat(200) }]);
    await cache.write("b", [{ kind: "session", id: "new", value: "b".repeat(200) }]);
    const evicted = await cache.readHost("a");
    const kept = await cache.readHost("b");
    await cache.write("b", [{ kind: "session", id: "new", value: "x".repeat(400) }]);
    const oversized = await cache.readHost("b");
    await cache.write("b", [{ kind: "models", id: "m", value: {} }, { kind: "projects", id: "", value: [] }]);
    await cache.removeHost("b");
    return { evicted, kept, oversized, forgotten: await cache.readHost("b") };
  });
  expect(result.evicted).toEqual([]);
  expect(result.kept).toHaveLength(1);
  expect(result.oversized).toEqual([]);
  expect(result.forgotten).toEqual([]);
});

test("restores models and transcript text offline after restart, then syncs from the saved revision", async ({ page }) => {
  await page.evaluate(async () => {
    const module = "/src/mobile/client.ts";
    const { MobileClient } = await import(module);
    const storage = {
      get: async (key: string) => localStorage.getItem(`test:${key}`),
      set: async (key: string, value: string) => { localStorage.setItem(`test:${key}`, value); },
      remove: async (key: string) => { localStorage.removeItem(`test:${key}`); },
    };
    const client = new MobileClient(storage, async (_endpoint: string, _token: string, input: any) => {
      if (input.method === "environment.describe") return { protocolVersion: 1, environmentId: "host-a", name: "A", providers: ["codex"] };
      if (input.method === "projects.list") return [{ id: "p", cwd: "/p", name: "Project" }];
      if (input.method === "models.list") return { models: { codex: [{ id: "codex:m", name: "Model", harness: "codex" }] }, errors: {} };
      return { kind: "snapshot", value: {
        projectId: "p", revision: 3, updatedAt: 3, status: "idle",
        session: { id: "s", title: "Saved conversation", cwd: "/p", harness: "codex", model: "codex:m",
          modelSettings: {}, runtimeMode: "supervised", blocks: [
            { id: "user", role: "user", text: "Remember this", attachments: [
              { id: "image", kind: "image", name: "image.png", mimeType: "image/png", size: 3, data: "YWJj", previewUrl: "blob:expired" },
            ] },
            { id: "reply", role: "assistant", text: "Saved answer" },
          ] },
      } };
    });
    await client.connect("http://computer", "token");
    await client.projects();
    await client.models("p");
    await client.session("s");
    await client.flushOfflineCache();
  });
  await page.reload();
  const restored = await page.evaluate(async () => {
    const module = "/src/mobile/client.ts";
    const { MobileClient } = await import(module);
    const storage = {
      get: async (key: string) => localStorage.getItem(`test:${key}`),
      set: async (key: string, value: string) => { localStorage.setItem(`test:${key}`, value); },
      remove: async (key: string) => { localStorage.removeItem(`test:${key}`); },
    };
    let online = false;
    const requests: any[] = [];
    const client = new MobileClient(storage, async (_endpoint: string, _token: string, input: any) => {
      requests.push(input);
      if (!online) throw new Error("Failed to fetch");
      if (input.method === "environment.describe") return { protocolVersion: 1, environmentId: "host-a", name: "A", providers: ["codex"] };
      if (input.method === "models.list") return { models: { codex: [{ id: "codex:new", name: "New model", harness: "codex" }] }, errors: {} };
      return { kind: "unchanged", revision: 3 };
    });
    await client.restore().catch(() => {});
    const preview = client.cachedSession("s");
    const projects = client.cachedProjects();
    const summaries = client.cachedSessions("p");
    let catalog: any;
    await client.models("p", false, (value: any) => { catalog = value; }).catch(() => {});
    online = true;
    await client.reconnect();
    const refreshed = await client.models("p");
    await client.session("s");
    await client.flushOfflineCache();
    await client.disconnect();
    const cacheModule = "/src/mobile/offlineCache.ts";
    const { mobileOfflineCache } = await import(cacheModule);
    return { preview, projects, summaries, catalog, refreshed, sync: requests.find(input => input.method === "sessions.sync"),
      forgotten: await mobileOfflineCache.readHost("host-a") };
  });
  expect(restored.preview.session.blocks.map((block: any) => block.text)).toEqual(["Remember this", "Saved answer"]);
  expect(restored.preview.session.blocks[0].attachments[0]).not.toHaveProperty("data");
  expect(restored.preview.session.blocks[0].attachments[0]).not.toHaveProperty("previewUrl");
  expect(restored.projects[0].name).toBe("Project");
  expect(restored.summaries[0].title).toBe("Saved conversation");
  expect(restored.catalog.models.codex[0].name).toBe("Model");
  expect(restored.refreshed.models.codex[0].name).toBe("New model");
  expect(restored.sync.params.revision).toBe(3);
  expect(restored.forgotten).toEqual([]);
});

test("storage failures are treated as an empty cache", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const module = "/src/mobile/offlineCache.ts";
    const { IndexedDbMobileOfflineCache } = await import(module);
    const cache = new IndexedDbMobileOfflineCache("denied-test");
    const original = indexedDB.open;
    indexedDB.open = () => { throw new DOMException("Denied", "SecurityError"); };
    try {
      await cache.write("a", [{ kind: "session", id: "s", value: {} }]);
      await cache.removeHost("a");
      return await cache.readHost("a");
    } finally { indexedDB.open = original; }
  });
  expect(result).toEqual([]);
});
