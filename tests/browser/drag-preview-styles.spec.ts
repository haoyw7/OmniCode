import { expect, test } from "@playwright/test";

test("refreshes document and body CSS while keeping existing previews unchanged", async ({ page }) => {
  await page.goto("/tests/browser/sortable-size.html");
  await expect(page.locator("[data-card]")).toHaveCount(3);
  const result = await page.evaluate(async () => {
    const path = "/src/shared/ui/primitives/DragPreview.tsx";
    const { captureDragPreview } = await import(path);
    const style = document.createElement("style"), source = document.createElement("div");
    source.className = "preview-style-test";
    style.textContent = ".preview-style-test { color: red; } .preview-style-test:hover { color: purple; }";
    source.append(style);
    document.body.append(source);
    await new Promise(resolve => setTimeout(resolve, 0));
    const snapshots: { element: HTMLElement; host: HTMLElement; cleanup(): void }[] = [];
    const capture = () => {
      const snapshot = captureDragPreview(source), host = document.createElement("div");
      document.body.append(host);
      const cleanup = snapshot.mount(host);
      snapshots.push({ element: snapshot.element, host, cleanup });
      return getComputedStyle(snapshot.element).color;
    };
    try {
      const first = capture();
      style.sheet!.insertRule(".preview-style-test { color: blue; }", 2);
      const second = capture();
      style.textContent = ".preview-style-test { color: green; }";
      await new Promise(resolve => setTimeout(resolve, 0));
      const third = capture();
      return { first, second, third, retained: getComputedStyle(snapshots[0].element).color, source: getComputedStyle(source).color };
    } finally {
      for (const snapshot of snapshots) { snapshot.cleanup(); snapshot.host.remove(); }
      source.remove();
    }
  });
  expect(result).toEqual({ first: "rgb(255, 0, 0)", second: "rgb(0, 0, 255)", third: "rgb(0, 128, 0)", retained: "rgb(255, 0, 0)", source: "rgb(0, 128, 0)" });
});

test("a complete pane preview keeps its own background decoration", async ({ page }) => {
  await page.goto("/tests/browser/sortable-size.html?status");
  await expect(page.locator('[data-status-card="tasks"]')).toBeVisible();
  const result = await page.evaluate(async () => {
    const source = document.querySelector<HTMLElement>("[data-session-status]")!.parentElement!;
    source.classList.add("chat-pane-background");
    source.dataset.projectChatBackground = "true";
    source.style.setProperty("--chat-background-image", "linear-gradient(teal, gold)");
    source.style.setProperty("--chat-background-opacity", "0.7");
    const read = (node: HTMLElement) => {
      const style = getComputedStyle(node, "::before");
      return { content: style.content, image: style.backgroundImage, opacity: style.opacity, display: style.display };
    };
    const before = read(source);
    const path = "/src/shared/ui/primitives/DragPreview.tsx";
    const { captureDragPreview } = await import(path);
    const snapshot = captureDragPreview(source), host = document.createElement("div");
    document.body.append(host);
    const cleanup = snapshot.mount(host);
    try { return { before, preview: read(snapshot.element), original: read(source) }; }
    finally { cleanup(); host.remove(); }
  });
  expect(result.before.content).toBe('""');
  expect(result.before.image).toContain("linear-gradient");
  expect(result.before.opacity).toBe("0.7");
  expect(result.preview).toEqual(result.before);
  expect(result.original).toEqual(result.before);
});

test("a rich diff preview retains its code, highlighted tokens and geometry", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/tests/browser/desktop-tools.html?editor=review&split=down&reviewResize");
  const pane = page.locator('css:light=[data-pane-id="tools-editor"]');
  await expect(pane).toBeVisible({ timeout: 30000 });
  const original = pane.locator("diffs-container").first();
  await expect(original.locator("[data-line] span").first()).toBeVisible({ timeout: 30000 });
  await expect(pane.locator("[aria-busy=true]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  // The initial plain-text render is followed by asynchronous tokenization.
  await expect.poll(() => original.evaluate(node => new Set([...node.shadowRoot!.querySelectorAll("[data-line] span")]
    .map(span => getComputedStyle(span).color)).size), { timeout: 30000 }).toBeGreaterThan(2);
  const read = (node: Element) => [...node.shadowRoot!.querySelectorAll<HTMLElement>("[data-line], [data-line] span, [data-column-number]")].map(line => {
    const { width, height } = line.getBoundingClientRect(), style = getComputedStyle(line);
    return { text: line.textContent, width, height, color: style.color, font: style.fontSize };
  });
  const before = await original.evaluate(read);
  await original.evaluate(node => node.setAttribute("data-retained", "true"));
  const grip = (await pane.locator("[data-surface-pane-drag]").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 30, grip.y + grip.height / 2 + 30);
  const preview = page.locator("css:light=[data-drag-preview]").locator("diffs-container").first();
  await expect(preview.locator("[data-line] span").first()).toBeVisible();
  const after = await preview.evaluate(read);
  expect(after.length).toBe(before.length);
  after.forEach((line, index) => {
    expect(line.text).toBe(before[index].text);
    expect(line.color).toBe(before[index].color);
    expect(line.font).toBe(before[index].font);
    expect(line.width).toBeCloseTo(before[index].width, 1);
    expect(line.height).toBeCloseTo(before[index].height, 1);
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(original).toHaveAttribute("data-retained", "true");
});
