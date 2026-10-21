import { expect, test, type Locator, type Page } from "@playwright/test";

async function dimensions(locator: Locator) {
  return locator.evaluateAll(nodes => nodes.map(node => {
    const { width, height } = node.getBoundingClientRect();
    return { width: Math.round(width * 1000) / 1000, height: Math.round(height * 1000) / 1000 };
  }));
}
async function start(page: Page, handle: Locator, target: Locator) {
  const from = (await handle.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator("css:light=" + ".sortable-overlay")).toBeVisible();
}
async function fixtureAction(page: Page, action: "rerender" | "unmount") {
  await page.evaluate(name => (window as unknown as { sortableFixture: Record<string, () => void> }).sortableFixture[name](), action);
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
  await expect(page.locator("css:light=" + '[data-fold-state="opening"], [data-fold-state="closing"]')).toHaveCount(0);
}

for (const horizontal of [false, true]) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`keeps sortable and child sizes until release (${horizontal ? "horizontal" : "vertical"}, ${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.goto(`/tests/browser/sortable-size.html${horizontal ? "?horizontal" : ""}`);
      const cards = page.locator("css:light=" + "[data-card]"), children = cards.locator("textarea");
      await expect(cards).toHaveCount(3);
      await settle(page);
      const before = await dimensions(cards), beforeChildren = await dimensions(children);
      await children.first().fill("Keep this input");
      await children.first().evaluate(node => node.setAttribute("data-retained", "true"));
      await start(page, cards.first().getByRole("button"), cards.last());
      const preview = page.locator("css:light=" + "[data-drag-preview]");
      expect(await dimensions(preview)).toEqual([before[0]]);
      expect(await dimensions(preview.locator("textarea"))).toEqual([beforeChildren[0]]);
      await expect(preview.locator("textarea")).toHaveValue("Keep this input");
      expect(await dimensions(cards)).toEqual(before);
      expect(await dimensions(children)).toEqual(beforeChildren);
      expect(await dimensions(preview)).toEqual([before[0]]);
      await expect(page.locator("css:light=" + "[data-commits]")).toHaveAttribute("data-commits", "0");
      await fixtureAction(page, "rerender");
      await expect(page.locator("css:light=" + "[data-revision]")).toHaveAttribute("data-revision", "1");
      expect(await dimensions(cards)).toEqual(before);
      expect(await dimensions(children)).toEqual(beforeChildren);
      await page.mouse.up();
      await expect(page.locator("css:light=" + "[data-commits]")).toHaveAttribute("data-commits", "1");
      await expect.poll(() => cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-card")))).toEqual(["b", "c", "a"]);
      await expect.poll(() => dimensions(cards)).not.toEqual(before);
      await expect(page.locator("css:light=" + '[data-card="a"] textarea')).toHaveValue("Keep this input");
      await expect(page.locator("css:light=" + '[data-card="a"] textarea')).toHaveAttribute("data-retained", "true");
      expect(await cards.evaluateAll(nodes => nodes.every(node => !(node as HTMLElement).style.width))).toBe(true);
    });
  }
}

for (const reason of ["Escape", "pointercancel", "blur", "lostpointercapture", "unmount"] as const) {
  test(`releases size locks on ${reason}`, async ({ page }) => {
    await page.goto("/tests/browser/sortable-size.html");
    const cards = page.locator("css:light=" + "[data-card]");
    await expect(cards).toHaveCount(3);
    await start(page, cards.first().getByRole("button"), cards.last());
    await fixtureAction(page, "rerender");
    if (reason === "Escape") await page.keyboard.press("Escape");
    else if (reason === "unmount") await fixtureAction(page, "unmount");
    else await page.evaluate(type => {
      if (type === "blur") window.dispatchEvent(new Event(type));
      else (type === "pointercancel" ? document : document.querySelector("[data-card]")!)
        .dispatchEvent(new PointerEvent(type, { pointerId: 1 }));
    }, reason);
    await page.mouse.up();
    await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
    await expect(page.locator("css:light=" + "[data-commits]")).toHaveAttribute("data-commits", "0");
    if (reason === "unmount") { await expect(cards).toHaveCount(0); return; }
    expect(await cards.evaluateAll(nodes => nodes.every(node => !(node as HTMLElement).style.width))).toBe(true);
    await expect.poll(async () => (await cards.first().boundingBox())!.width).toBe(430);
    await start(page, cards.first().getByRole("button"), cards.last());
    await page.mouse.up();
    await expect(page.locator("css:light=" + "[data-commits]")).toHaveAttribute("data-commits", "1");
  });
}

test("keyboard sorting retains sizes until commit", async ({ page }) => {
  await page.goto("/tests/browser/sortable-size.html?horizontal");
  const cards = page.locator("css:light=" + "[data-card]");
  await expect(cards).toHaveCount(3);
  await settle(page);
  const before = await dimensions(cards), beforeChildren = await dimensions(cards.locator("textarea"));
  await cards.first().getByRole("button").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("css:light=" + "[data-drag-preview]")).toBeVisible();
  const announcement = page.locator("css:light=" + '[id^="DndLiveRegion"]');
  await expect(announcement).toContainText("Moving to position 1.");
  await page.keyboard.press("ArrowRight");
  await expect(announcement).toContainText("Moving to position 2.");
  await fixtureAction(page, "rerender");
  expect(await dimensions(cards)).toEqual(before);
  expect(await dimensions(cards.locator("textarea"))).toEqual(beforeChildren);
  await expect(page.locator("css:light=" + "[data-commits]")).toHaveAttribute("data-commits", "0");
  await page.keyboard.press("Space");
  await expect(page.locator("css:light=" + "[data-commits]")).toHaveAttribute("data-commits", "1");
});

for (const section of [false, true]) {
  test(`keeps expanded sidebar ${section ? "sections" : "projects"} and their contents the same size`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/tests/browser/sortable-size.html?sidebar");
    const cards = section ? page.locator("css:light=" + "[data-sidebar-reorder-section]") : page.locator("css:light=" + "[data-project-path]");
    await expect(cards).toHaveCount(section ? 4 : 3);
    await settle(page);
    const origin = section ? page.locator("css:light=" + '[data-sidebar-reorder-section="projects"]') : cards.first();
    const handle = origin.locator(section ? "[data-sidebar-section-toggle]" : "[data-project-select]").first();
    const target = section ? cards.nth(1) : cards.last();
    const contents = origin.locator("textarea, [data-project-content], [data-project-select], .project-name");
    const before = await dimensions(cards), beforeChildren = await dimensions(contents);
    const originalSize = await dimensions(origin);
    const textareaSizes = await dimensions(origin.locator("textarea"));
    await origin.locator("textarea").first().fill("Retained sidebar draft");
    await start(page, handle, target);
    const preview = page.locator("css:light=" + "[data-drag-preview]");
    expect(await dimensions(preview)).toEqual(originalSize);
    expect(await dimensions(preview.locator("textarea"))).toEqual(textareaSizes);
    await expect(preview.locator("textarea").first()).toHaveValue("Retained sidebar draft");
    await page.screenshot({ path: test.info().outputPath("sidebar-preview.png") });
    expect(await dimensions(cards)).toEqual(before);
    expect(await dimensions(contents)).toEqual(beforeChildren);
    await expect(origin.locator(".project-tree-collapse").first()).toHaveAttribute("data-fold-state", "open");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
    await expect(origin.locator("textarea").first()).toHaveValue("Retained sidebar draft");
  });
}

for (const kind of ["sessions", "status"] as const) {
  test(`shows the complete ${kind} preview at the source size`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(`/tests/browser/sortable-size.html?${kind}`);
    const cards = page.locator("css:light=" + (kind === "sessions" ? "[data-sidebar-pinned-entry]" : "[data-status-card]"));
    await expect(cards.first()).toBeVisible();
    await settle(page);
    const source = kind === "sessions" ? cards.first() : page.locator("css:light=" + '[data-status-card="tasks"]');
    await expect(source).toHaveCSS("opacity", "1");
    if (kind === "status") {
      await expect(page.locator("css:light=" + "[data-session-status]")).toHaveCSS("opacity", "1");
      await expect(page.locator("css:light=" + "[data-session-status]")).toHaveCSS("transform", "none");
    }
    const handle = source.locator(kind === "sessions" ? "[data-session-select]" : "[data-status-card-handle]");
    await handle.hover();
    const originalSize = await dimensions(source);
    const content = await source.textContent();
    // Include title, icon, buttons and expanded card content, not only the wrapper.
    const geometry = await source.evaluate(node => [node, ...node.querySelectorAll("*")].map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { tag: element.tagName, html: element instanceof HTMLElement, width: rect.width, height: rect.height,
        layoutWidth: style.width, layoutHeight: style.height, fontSize: style.fontSize };
    }));
    await start(page, handle, cards.last());
    const preview = page.locator("css:light=" + "[data-drag-preview]");
    expect(await dimensions(preview)).toEqual(originalSize);
    expect(await preview.locator("[data-drag-preview-content]").textContent()).toBe(content);
    const copyGeometry = await preview.locator("[data-drag-preview-content]").evaluate(node => [node, ...node.querySelectorAll("*")].map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { tag: element.tagName, html: element instanceof HTMLElement, width: rect.width, height: rect.height,
        layoutWidth: style.width, layoutHeight: style.height, fontSize: style.fontSize };
    }));
    await test.info().attach("preview-geometry", { body: JSON.stringify({ geometry, copyGeometry }), contentType: "application/json" });
    await page.screenshot({ path: test.info().outputPath(`${kind}-preview.png`) });
    expect(copyGeometry.length).toBe(geometry.length);
    copyGeometry.forEach((copy, index) => {
      expect(copy.tag).toBe(geometry[index].tag);
      expect(copy.fontSize).toBe(geometry[index].fontSize);
      // A running SVG spinner may rotate between capture and pointer activation;
      // compare its untransformed layout size, not the rotating path's bounds.
      if (copy.html) {
        expect(copy.width, `width of node ${index} (${copy.tag})`).toBeCloseTo(geometry[index].width, 1);
        expect(copy.height, `height of node ${index} (${copy.tag})`).toBeCloseTo(geometry[index].height, 1);
      } else {
        expect(copy.layoutWidth).toBe(geometry[index].layoutWidth);
        expect(copy.layoutHeight).toBe(geometry[index].layoutHeight);
      }
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`preserves status preview transparency and rounded corners (${scheme})`, async ({ page }) => {
    await page.goto("/tests/browser/sortable-size.html?status");
    await page.evaluate(light => {
      document.documentElement.classList.toggle("theme-light", light);
      document.documentElement.dataset.skin = light ? "daylight" : "ripple";
      document.documentElement.style.setProperty("--panel-opacity", "0.42");
      const background = document.querySelector<HTMLElement>("[data-session-status]")!.parentElement!;
      background.classList.add("chat-pane-background");
      background.dataset.projectChatBackground = "true";
      background.style.isolation = "isolate";
      background.style.setProperty("--chat-background-image", "repeating-linear-gradient(35deg, #3478cf 0 50px, #e7b951 50px 100px)");
      background.style.setProperty("--chat-background-opacity", "1");
    }, scheme === "light");
    const rail = page.locator("css:light=" + "[data-session-status]");
    const card = page.locator("css:light=" + '[data-status-card="tasks"]');
    await expect(card).toBeVisible();
    await settle(page);
    await expect(rail).toHaveCSS("opacity", "1");
    await expect(rail).toHaveCSS("transform", "none");
    const appearance = (locator: Locator) => locator.evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, opacity: style.opacity, radius: style.borderRadius, shadow: style.boxShadow };
    });
    const before = await appearance(card);
    expect(before.radius).toBe("10px");
    const artwork = page.locator("css:light=.chat-pane-background");
    const sourceArtwork = await artwork.evaluate(node => {
      const style = getComputedStyle(node, "::before");
      return { content: style.content, image: style.backgroundImage, opacity: style.opacity };
    });
    expect(sourceArtwork.content).toBe('""');
    expect(sourceArtwork.image).toContain("repeating-linear-gradient");
    expect(sourceArtwork.opacity).toBe("1");
    await start(page, card.locator("[data-status-card-handle]"), page.locator("css:light=" + '[data-status-card="environment"]'));
    const preview = page.locator("css:light=" + "[data-drag-preview]");
    expect(await appearance(preview.locator("[data-drag-preview-content]"))).toEqual(before);
    // An opaque square wrapper would change both the alpha and corner pixels,
    // even when the cloned card's own computed styles are correct.
    await expect(preview).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(preview).toHaveCSS("box-shadow", "none");
    await expect(preview).toHaveCSS("opacity", "1");
    const inheritedDecoration = await preview.locator("[data-preview-ancestor]").evaluateAll(nodes =>
      nodes.flatMap(node => ["::before", "::after"].map(pseudo => {
        const style = getComputedStyle(node, pseudo);
        return style.content !== "none" && style.content !== "normal" && style.display !== "none";
      })),
    );
    expect(inheritedDecoration.some(Boolean)).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`status-appearance-${scheme}.png`) });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
    await expect.poll(() => appearance(card)).toEqual(before);
    expect(await artwork.evaluate(node => {
      const style = getComputedStyle(node, "::before");
      return { content: style.content, image: style.backgroundImage, opacity: style.opacity };
    })).toEqual(sourceArtwork);
  });
}

for (const sourceId of ["environment", "changes", "tasks", "context"] as const) {
  test(`places ${sourceId} at the end of the status cards`, async ({ page }) => {
    await page.goto("/tests/browser/sortable-size.html?status");
    const rail = page.locator("css:light=" + "[data-session-status]");
    await expect(rail).toBeVisible();
    await settle(page);
    await expect(rail).toHaveCSS("opacity", "1");
    await expect(rail).toHaveCSS("transform", "none");
    const cards = page.locator("css:light=" + "[data-status-card]");
    const before = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-status-card")));
    const source = page.locator("css:light=" + `[data-status-card="${sourceId}"]`);
    const from = (await source.locator("[data-status-card-handle]").boundingBox())!;
    const last = (await cards.last().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height + 6, { steps: 8 });
    await expect(page.locator("css:light=" + "[data-drag-preview]")).toBeVisible();
    expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-status-card")))).toEqual(before);
    await page.mouse.up();
    await expect(page.locator("css:light=" + "[data-drag-preview]")).toHaveCount(0);
    await expect.poll(() => cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-status-card"))))
      .toEqual([...before.filter(id => id !== sourceId), sourceId]);
    await page.reload();
    await expect(cards.last()).toHaveAttribute("data-status-card", sourceId);
  });
}

test("accepts the visible header of a tall final status card", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto("/tests/browser/sortable-size.html?status&longContext");
  const rail = page.locator("css:light=" + "[data-session-status]");
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS("transform", "none");
  const source = page.locator("css:light=" + '[data-status-card="changes"]');
  const last = page.locator("css:light=" + '[data-status-card="context"]');
  await source.locator("button[aria-expanded]").click();
  await last.locator("button[aria-expanded]").click();
  await settle(page);
  const lastBox = (await last.boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeGreaterThan(600);
  await start(page, source.locator("[data-status-card-handle]"), last.locator("button[aria-expanded]"));
  await page.mouse.up();
  await expect(page.locator("css:light=" + "[data-drag-preview]")).toHaveCount(0);
  await expect(page.locator("css:light=" + "[data-status-card]").last()).toHaveAttribute("data-status-card", "changes");
});

test("keyboard sorting can return from the final card to its original position", async ({ page }) => {
  await page.goto("/tests/browser/sortable-size.html?status");
  const rail = page.locator("css:light=" + "[data-session-status]");
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS("transform", "none");
  await settle(page);
  const cards = page.locator("css:light=" + "[data-status-card]");
  const before = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-status-card")));
  await cards.first().locator("[data-status-card-handle]").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("css:light=" + "[data-drag-preview]")).toBeVisible();
  const announcement = page.locator("css:light=" + '[id^="DndLiveRegion"]');
  for (let i = 1; i < before.length; i++) {
    await page.keyboard.press("ArrowDown");
    await expect(announcement).toContainText(`Moving to position ${i + 1}.`);
  }
  for (let i = before.length - 2; i >= 0; i--) {
    await page.keyboard.press("ArrowUp");
    await expect(announcement).toContainText(`Moving to position ${i + 1}.`);
  }
  await page.keyboard.press("Space");
  await expect(page.locator("css:light=" + "[data-drag-preview]")).toHaveCount(0);
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-status-card")))).toEqual(before);
});
