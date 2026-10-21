import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Explicit diagnostic: browser event dispatch is not native input-to-present.
test.skip(process.env.RIPPLE_DRAG_PERFORMANCE !== "1", "Run the drag diagnostic explicitly on a stable, idle machine.");
const cases = [
  { name: "long chat", url: "desktop-tools.html?editor=source&explorer&history=long&split=down", source: '[data-pane-id="tools-session"]', handle: '[data-session-surface-tabs="tools-session"] [data-surface-pane-drag]' },
  { name: "editor", url: "desktop-tools.html?editor=source&explorer&history=long&split=down", source: '[data-pane-id="tools-editor"]', handle: '[data-pane-id="tools-editor"] [data-surface-pane-drag]' },
  { name: "terminal", url: "desktop-tools.html?editor=terminal&history=long&split=down", source: '[data-pane-id="tools-editor"]', handle: '[data-pane-id="tools-editor"] [data-surface-pane-drag]' },
  { name: "sidebar project", url: "sortable-size.html?sidebar", source: "[data-project-path]", handle: "[data-project-path] [data-project-select]" },
  { name: "sidebar session", url: "sortable-size.html?sessions", source: "[data-sidebar-pinned-entry]", handle: "[data-sidebar-pinned-entry] [data-session-select]" },
  { name: "status card", url: "sortable-size.html?status", source: '[data-status-card="tasks"]', handle: '[data-status-card="tasks"] [data-status-card-handle]' },
];

for (const scenario of cases) test(`activation dispatch P95 below 5ms: ${scenario.name}`, async ({ page }, info) => {
  test.setTimeout(180000);
  const baselinePath = process.env.RIPPLE_DRAG_BASELINE;
  let mode = "candidate";
  const timeline: { type: string; at: number }[] = [];
  page.on("websocket", socket => socket.on("framereceived", frame => {
    try { const message = JSON.parse(String(frame.payload)); if (["update", "full-reload"].includes(message.type)) timeline.push({ type: message.type, at: Date.now() }); } catch { /* Non-JSON frame. */ }
  }));
  if (baselinePath) await page.route("**/src/shared/ui/primitives/DragPreview.tsx*", async route => {
    if (mode === "candidate") return route.continue();
    const url = new URL(baselinePath, route.request().url()).toString();
    await route.fulfill({ response: await route.fetch({ url }) });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  const results: { mode: string; nodes: number; samples: { dispatch: number; queue: number }[]; events: unknown[]; focused: boolean }[] = [];
  for (mode of baselinePath ? ["baseline", "candidate", "baseline", "candidate"] : ["candidate", "candidate"]) {
    await page.goto(`/tests/browser/${scenario.url}`);
    const source = page.locator(`css:light=${scenario.source}`).first();
    await expect(source).toBeVisible({ timeout: 30000 });
    if (scenario.url.startsWith("desktop-tools")) {
      await expect(page.locator("css:light=.xterm-rows").first()).toContainText("git status", { timeout: 30000 });
      if (scenario.name !== "terminal") await expect(page.locator("css:light=.cm-editor")).toBeVisible({ timeout: 30000 });
    }
    const settle = async () => page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    });
    await settle();
    if (await page.locator("css:light=.cm-content").count()) {
      await expect.poll(() => page.evaluate(() => new Set([...document.querySelectorAll(".cm-content span")]
        .map(span => getComputedStyle(span).color)).size), { timeout: 30000 }).toBeGreaterThan(2);
    }
    // Stylesheet text is implementation metadata, not rendered terminal output.
    const readContent = () => source.evaluate(node => {
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll("style, script, link").forEach(child => child.remove());
      return { text: copy.textContent, count: copy.querySelectorAll("*").length };
    });
    const originalContent = await readContent();
    const originalText = originalContent.text, nodes = originalContent.count;
    const handle = page.locator(`css:light=${scenario.handle}`).first();
    const grip = (await handle.boundingBox())!;
    await page.evaluate(() => {
      let start = 0, queue = 0;
      const samples: { dispatch: number; queue: number }[] = [], events: { type: string; at: number }[] = [];
      const state = { armed: false };
      const begin = (event: PointerEvent) => { if (state.armed) { start = performance.now(); queue = Math.max(0, start - event.timeStamp); } };
      const end = () => { if (state.armed) { samples.push({ dispatch: performance.now() - start, queue }); state.armed = false; } };
      const focus = (event: Event) => { if (event.target === window) events.push({ type: event.type, at: performance.now() }); };
      window.addEventListener("pointermove", begin, true);
      window.addEventListener("pointermove", end);
      window.addEventListener("blur", focus);
      window.addEventListener("focus", focus);
      Object.assign(window, { dragStartProfile: { state, finish: () => {
        window.removeEventListener("pointermove", begin, true); window.removeEventListener("pointermove", end);
        window.removeEventListener("blur", focus); window.removeEventListener("focus", focus);
        return { samples, events, focused: document.hasFocus() };
      } } });
    });
    try {
      for (let index = 0; index < 20; index++) {
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.evaluate(() => { (window as any).dragStartProfile.state.armed = true; });
        await page.mouse.move(grip.x + grip.width / 2 + 8, grip.y + grip.height / 2 + 8);
        const preview = page.locator("css:light=[data-drag-preview]");
        await expect(preview).toBeVisible();
        const content = mode === "baseline" ? preview.locator(":scope > *") : preview.locator("[data-drag-preview-content]");
        await expect(content).toHaveText(originalText ?? "");
        expect(await content.locator("*").count()).toBe(nodes);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(preview).toHaveCount(0);
        await settle();
      }
    } finally {
      results.push({ mode, nodes, ...await page.evaluate(() => (window as any).dragStartProfile.finish()) });
    }
    expect(await readContent()).toEqual(originalContent);
  }
  const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
  const summary = results.map(r => ({ mode: r.mode, nodes: r.nodes, count: r.samples.length, firstDispatch: r.samples[0].dispatch, dispatchP95: p95(r.samples.map(s => s.dispatch)), browserQueueP95: p95(r.samples.map(s => s.queue)), events: r.events, focused: r.focused }));
  await writeFile(info.outputPath("samples.json"), JSON.stringify({ scenario: scenario.name, timeline, summary, results }, null, 2));
  for (const row of summary) console.log(JSON.stringify({ scenario: scenario.name, ...row }));
  expect(timeline).toEqual([]);
  expect(results.every(r => r.samples.length === 20 && r.focused && r.events.length === 0)).toBe(true);
  expect(summary.filter(r => r.mode === "candidate").every(r => r.dispatchP95 < 5)).toBe(true);
});
