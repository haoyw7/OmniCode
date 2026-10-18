import { expect, test } from "@playwright/test";

// Headless Chromium otherwise reserves scrollbar space but suppresses painting/hits.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/scrollbars.html");
  await page.waitForFunction(() => "scrollbarFixture" in window);
  await page.evaluate(async () => {
    await (window as any).scrollbarFixture.terminalReady;
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
});

test("native, read-only and shadow-root scrollbars share geometry and end buttons", async ({
  page,
}) => {
  for (const selector of [
    "#native",
    "#readonly .cm-scroller",
    "#horizontal",
    "#shadow .scroll",
  ]) {
    const styles = await page.locator(selector).evaluate((el) => {
      const rail = getComputedStyle(el, "::-webkit-scrollbar");
      const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
      return {
        width: rail.width,
        height: rail.height,
        border: thumb.borderTopStyle,
        radius: thumb.borderRadius,
      };
    });
    expect(styles).toEqual({
      width: "7px",
      height: "7px",
      border: "solid",
      radius: "9999px",
    });
  }
  const native = page.locator("#native");
  expect(await native.evaluate((el) => el.offsetWidth - el.clientWidth)).toBe(
    7,
  );
  expect(
    await page
      .locator("#short")
      .evaluate((el) => el.offsetWidth - el.clientWidth),
  ).toBe(0);
  const box = (await native.boundingBox())!;
  const clientHeight = await native.evaluate((el) => el.clientHeight);
  await page.mouse.click(box.x + box.width - 3, box.y + clientHeight - 3, {
    delay: 100,
  });
  await expect
    .poll(() => native.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const horizontal = page.locator("#horizontal");
  await horizontal.hover();
  // Let the native scrollbar finish painting after hover before hitting its button.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const hbox = (await horizontal.boundingBox())!;
  await page.mouse.click(
    hbox.x + hbox.width - 3.5,
    hbox.y + hbox.height - 3.5,
    { delay: 100 },
  );
  await expect
    .poll(() => horizontal.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "build/browser-tests/scrollbars-daylight.png",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.skin = "midnight";
  });
  await page.screenshot({
    path: "build/browser-tests/scrollbars-midnight.png",
  });
});

test("custom rails reserve arrows, reach both ends and support a second drag", async ({
  page,
}) => {
  for (const id of ["editor", "terminal", "timeline"]) {
    const rail = page.locator(`#${id} [data-ui="scrollbar"]`);
    const thumb = rail.locator('[data-ui="scrollbar-thumb"]');
    await expect(rail).toBeVisible();
    const horizontal = id === "timeline";
    const railBox = (await rail.boundingBox())!;
    expect(horizontal ? railBox.height : railBox.width).toBe(7);
    // At either endpoint, the thumb stays out of the arrow slots.
    for (const end of [false, true, false]) {
      const thumbBox = (await thumb.boundingBox())!;
      await page.mouse.move(
        thumbBox.x + thumbBox.width / 2,
        thumbBox.y + thumbBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        horizontal ? railBox.x + (end ? railBox.width : 0) : railBox.x + 3,
        horizontal ? railBox.y + 3 : railBox.y + (end ? railBox.height : 0),
        { steps: 5 },
      );
      await page.mouse.up();
      await expect(rail).not.toHaveAttribute("data-dragging");
      await expect
        .poll(async () => {
          const box = (await thumb.boundingBox())!;
          return horizontal
            ? end
              ? railBox.x + railBox.width - box.x - box.width
              : box.x - railBox.x
            : end
              ? railBox.y + railBox.height - box.y - box.height
              : box.y - railBox.y;
        })
        .toBeCloseTo(horizontal ? 7 : 9, 0);
    }
  }
});

test("sidebar scrolls without fading and preserves the scrollbar edge gap", async ({ page }) => {
  const sidebar = page.locator("#sidebar");
  const scroller = sidebar.locator("[data-project-list-scroll]");
  await expect(scroller).toBeVisible();
  await sidebar.scrollIntoViewIfNeeded();
  await page.mouse.move(950, 100);
  const box = (await scroller.boundingBox())!;
  const sidebarBox = (await sidebar.boundingBox())!;
  expect(sidebarBox.x + sidebarBox.width - box.x - box.width).toBe(1);
  expect(await scroller.evaluate(el => el.offsetWidth - el.clientWidth)).toBe(7);
  for (const position of ["top", "middle", "bottom"]) {
    await scroller.evaluate((el, position) => {
      el.scrollTop = position === "top" ? 0 : position === "middle" ? 100 : el.scrollHeight;
    }, position);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(scroller).toHaveCSS("mask-image", "none");
    const clip = { x: box.x + box.width - 7, y: box.y, width: 7, height: box.height };
    // The last rail pixel stays background beside both the thumb and empty track
    // (the sidebar divider occupies only 0.5px).
    const edge = await page.screenshot({ clip: { x: clip.x + 6, y: clip.y + 10, width: 1, height: 20 } });
    const background = await page.screenshot({ clip: { x: clip.x + 6, y: clip.y + 90, width: 1, height: 20 } });
    expect(edge.equals(background), `${position}: thumb stays 1px inside the edge`).toBe(true);
  }
  await sidebar.screenshot({ path: "build/browser-tests/scrollbars-sidebar.png" });
  // A divider shares the sidebar's edge in the app. Check the separate gutter
  // in dark mode at fractional zoom, where a transparent thumb border alone
  // can round into the divider's pixel.
  await page.evaluate(() => { document.documentElement.dataset.skin = "midnight"; });
  for (const zoom of [1, 1.25]) {
    await sidebar.evaluate((el, zoom) => { el.style.zoom = String(zoom); }, zoom);
    await sidebar.scrollIntoViewIfNeeded();
    const outer = (await sidebar.boundingBox())!;
    const inner = (await scroller.boundingBox())!;
    expect(outer.x + outer.width - inner.x - inner.width).toBeCloseTo(zoom, 2);
    const gutter = await page.screenshot({ clip: {
      x: Math.floor(inner.x + inner.width), y: Math.ceil(inner.y + 20), width: 1, height: 60,
    } });
    const background = await page.screenshot({ clip: {
      x: Math.ceil(outer.x + 1), y: Math.ceil(inner.y + 20), width: 1, height: 60,
    } });
    expect(gutter.equals(background), `zoom ${zoom}: background separates the rail from the divider`).toBe(true);
    await sidebar.screenshot({ path: `build/browser-tests/scrollbars-sidebar-dark-${zoom}.png` });
  }
});

test("rounded vertical arrows are 6px square and darken only at their endpoint", async ({
  page,
}) => {
  await page.mouse.move(950, 780);
  for (const selector of ["#native", "#horizontal", "#shadow .scroll"]) {
    const el = page.locator(selector);
    const horizontal = selector !== "#native";
    const box = (await el.boundingBox())!;
    const size = await el.evaluate((node) => ({
      width: node.clientWidth,
      height: node.clientHeight,
    }));
    const topClip = horizontal
      ? { x: box.x, y: box.y + box.height - 7, width: 7, height: 7 }
      : { x: box.x + box.width - 7, y: box.y, width: 7, height: 9 };
    const endClip = horizontal
      ? { ...topClip, x: box.x + size.width - 7 }
      : { ...topClip, y: box.y + size.height - 9 };
    const topDark = await page.screenshot({ clip: topClip });
    const endLight = await page.screenshot({ clip: endClip });
    await el.evaluate((node, horizontal) => {
      if (horizontal) node.scrollLeft = 100;
      else node.scrollTop = 100;
    }, horizontal);
    await expect(el).toHaveAttribute(
      `data-scrollbar-start-${horizontal ? "x" : "y"}`,
      "false",
    );
    const topLight = await page.screenshot({ clip: topClip });
    expect(topLight.equals(topDark)).toBe(false);
    expect((await page.screenshot({ clip: endClip })).equals(endLight)).toBe(
      true,
    );
    await el.evaluate((node, horizontal) => {
      if (horizontal) node.scrollLeft = node.scrollWidth;
      else node.scrollTop = node.scrollHeight;
    }, horizontal);
    await expect(el).toHaveAttribute(
      `data-scrollbar-end-${horizontal ? "x" : "y"}`,
      "true",
    );
    expect((await page.screenshot({ clip: endClip })).equals(endLight)).toBe(
      false,
    );
  }
  const rail = page.locator('#editor [data-ui="scrollbar"]');
  const first = rail.locator('[data-direction="start"]');
  const last = rail.locator('[data-direction="end"]');
  const geometry = await first.evaluate((el) => {
    const triangle = getComputedStyle(el, "::before");
    const thumb = getComputedStyle(
      el.parentElement!.querySelector('[data-ui="scrollbar-thumb"]')!,
    );
    return {
      width: triangle.width,
      height: triangle.height,
      inset: triangle.left,
      visibleThumb:
        parseFloat(thumb.width) -
        parseFloat(thumb.borderLeftWidth) -
        parseFloat(thumb.borderRightWidth),
    };
  });
  expect(geometry).toEqual({ width: "6px", height: "6px", inset: "0.5px", visibleThumb: 5 });
  const dark = await first.evaluate((el) => getComputedStyle(el).color);
  const light = await last.evaluate((el) => getComputedStyle(el).color);
  expect(dark).not.toBe(light);
  await page.locator("#editor .cm-scroller").evaluate((el) => {
    el.scrollTop = 100;
  });
  await expect(first).toHaveCSS("color", light);
  await expect(last).toHaveCSS("color", light);
  await page.locator("#editor .cm-scroller").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(last).toHaveCSS("color", dark);
  // Content grows without another scroll: an old bottom arrow must return to light.
  const native = page.locator("#native");
  await native.evaluate((el) =>
    el.firstElementChild!.append(document.createElement("div")),
  );
  await native.evaluate((el) => {
    (el.firstElementChild!.lastElementChild as HTMLElement).style.height =
      "100px";
  });
  await expect(native).toHaveAttribute("data-scrollbar-end-y", "false");
  await native.evaluate((el) => el.remove());
  await expect(native).toHaveCount(0);
});

test("terminal alt buffer and short editor hide rails, restore without replacing the terminal", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { terminal, view } = (window as any).scrollbarFixture;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "short" },
    });
    await new Promise<void>((resolve) =>
      terminal.write("\x1b[?1049h", resolve),
    );
  });
  await expect(page.locator('#editor [data-ui="scrollbar"]')).toBeHidden();
  await expect(page.locator('#terminal [data-ui="scrollbar"]')).toBeHidden();
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      (window as any).scrollbarFixture.terminal.write("\x1b[?1049l", resolve),
    );
  });
  await expect(page.locator('#terminal [data-ui="scrollbar"]')).toBeVisible();
});

test("interrupted drags release capture and a resized horizontal rail still reaches the end", async ({
  page,
}) => {
  const rail = page.locator('#timeline [data-ui="scrollbar"]');
  const thumb = rail.locator('[data-ui="scrollbar-thumb"]');
  for (const reason of ["escape", "blur", "pointercancel", "lostcapture"]) {
    const box = (await thumb.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(rail).toHaveAttribute("data-dragging", "true");
    // Let Chromium apply the pending capture before deliberately taking it away.
    await page.mouse.move(box.x + box.width / 2 + 0.5, box.y + box.height / 2);
    if (reason === "escape") await page.keyboard.press("Escape");
    else if (reason === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else
      await rail.evaluate((el, reason) => {
        if (reason === "lostcapture") el.releasePointerCapture(1);
        else
          el.dispatchEvent(
            new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }),
          );
      }, reason);
    // Native lostpointercapture is delivered with the next pointer event.
    if (reason === "lostcapture")
      await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await expect(rail, reason).not.toHaveAttribute("data-dragging");
    expect(await rail.evaluate((el) => el.hasPointerCapture(1))).toBe(false);
    await page.mouse.up();
  }
  await page.locator("#timeline").evaluate((el) => {
    el.style.width = "180px";
  });
  await expect(rail).toHaveCSS("width", "180px");
  const box = (await thumb.boundingBox())!;
  const track = (await rail.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width, track.y + 3);
  await page.mouse.up();
  await expect
    .poll(() =>
      page
        .locator("#timeline .wf-scroller")
        .evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft),
    )
    .toBe(0);
  await page.evaluate(() => (window as any).scrollbarFixture.destroy());
  await expect(page.locator('[data-ui="scrollbar"]')).toHaveCount(0);
});
