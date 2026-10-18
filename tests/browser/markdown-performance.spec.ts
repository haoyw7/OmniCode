import { expect, test } from "@playwright/test";

// Opt in on a controlled host: MARKDOWN_PERFORMANCE=1 npm run test:browser -- markdown-performance
const checkFrameTimes = process.env.MARKDOWN_PERFORMANCE === "1";

for (const reveal of ["transcript", "standalone"] as const) {
  test(`streaming a large Markdown fence keeps animations responsive (${reveal})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    if (checkFrameTimes && testInfo.project.name === "chromium") {
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    const workerUrls: string[] = [];
    page.on("worker", (worker) => workerUrls.push(worker.url()));
    await page.goto(
      `/tests/browser/markdown-performance.html${reveal === "standalone" ? "?wordFade" : ""}`,
    );
    await expect(page.locator(".agent-markdown")).toContainText(["Ready."]);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const gaps: number[] = [];
      let last = performance.now();
      let frame = 0;
      let sawWordFade = false;
      const sample = (now: number) => {
        sawWordFade ||= !!document.querySelector("[data-word-fade]");
        gaps.push(now - last);
        last = now;
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      Object.assign(window, {
        finishMarkdownSamples: () => {
          cancelAnimationFrame(frame);
          return { gaps, sawWordFade };
        },
      });
      (
        window as unknown as { startMarkdownStream(): void }
      ).startMarkdownStream();
    });
    const code = page.locator('[data-streamdown="code-block-body"] code');
    await expect(code.locator("span span").first()).toBeVisible();
    const firstLine = await code
      .locator(":scope > span")
      .first()
      .elementHandle();
    await expect(code).toContainText("requirement79", { timeout: 60_000 });
    const expected = await page.evaluate(() =>
      (
        window as unknown as { markdownSource: string }
      ).markdownSource.trimEnd(),
    );
    // Wait for the final asynchronous worker highlight before checking copies.
    await expect
      .poll(
        () =>
          code.evaluate((el) =>
            Array.from(el.children, (line) =>
              line.textContent === "\n" ? "" : line.textContent,
            )
              .join("\n")
              .trimEnd(),
          ),
        { timeout: 60_000 },
      )
      .toBe(expected);
    if (reveal === "transcript")
      await expect(page.locator('[data-selectable-agent-response="reply"]')).toBeAttached();
    // Include the final highlight and the removal of the lingering word fades.
    await expect(page.locator("[data-word-fade]")).toHaveCount(0, {
      timeout: 60_000,
    });
    await expect(code.locator("span span").first()).toBeVisible();
    const { gaps, sawWordFade } = await page.evaluate(() =>
      (
        window as unknown as {
          finishMarkdownSamples(): { gaps: number[]; sawWordFade: boolean };
        }
      ).finishMarkdownSamples(),
    );
    const sorted = [...gaps].sort((a, b) => a - b);
    const metrics = {
      frames: gaps.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: Math.max(...gaps),
      over50ms: gaps.filter((gap) => gap > 50).length,
      elapsed: gaps.reduce((sum, gap) => sum + gap, 0),
    };
    await testInfo.attach("frame-times", {
      body: JSON.stringify({ metrics, gaps }),
      contentType: "application/json",
    });
    // Optional thresholds from upstream's controlled benchmark; they have not
    // been recalibrated for this fork's Worker and character-reveal path.
    // Default runs record frame times and check functional behavior. Enable the
    // thresholds only on a controlled host; shared CI scheduling can exceed them.
    if (checkFrameTimes) {
      if (testInfo.project.name === "chromium") {
        expect(metrics.p95).toBeLessThan(75);
        expect(metrics.max).toBeLessThan(150);
      } else {
        expect(metrics.max).toBeLessThan(90);
      }
    }
    expect(sawWordFade).toBe(true);
    expect(workerUrls.some((url) => url.includes("codeHighlight.worker"))).toBe(
      true,
    );
    expect(await firstLine?.evaluate((line) => line.isConnected)).toBe(true);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            Object.assign(window, { copiedMarkdown: text });
          },
        },
      });
    });
    if (reveal === "transcript") {
      await page.locator(".agent-transcript").hover();
      await page.mouse.wheel(0, -400);
      await expect(page.locator(".agent-transcript")).toHaveAttribute("data-follow-latest", "false");
    }
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { copiedMarkdown: string }
        ).copiedMarkdown.trimEnd(),
      ),
    ).toBe(expected);
    const token = code.locator("span span").first();
    const darkColor = await token.evaluate((el) => getComputedStyle(el).color);
    await page.evaluate(() =>
      document.documentElement.classList.add("theme-light"),
    );
    expect(await token.evaluate((el) => getComputedStyle(el).color)).not.toBe(
      darkColor,
    );
  });
}

test("fallback fences preserve blank lines and line numbering in both themes", async ({
  page,
}) => {
  await page.goto("/tests/browser/markdown-performance.html");
  await expect(page.locator(".agent-markdown")).toContainText(["Ready."]);
  await page.evaluate(() =>
    (
      window as unknown as { showMarkdownExample(text: string): void }
    ).showMarkdownExample(
      "```foo noLineNumbers\na\n\nb\n```\n\n```foo startLine=17\na\n\nb\n```",
    ),
  );
  const codes = page.locator('[data-streamdown="code-block-body"] code');
  await expect(codes).toHaveCount(2);
  // Wait for the async plaintext highlight, rather than testing its raw fallback.
  await expect(codes.nth(0).locator("span span")).toHaveCount(2);
  await expect(codes.nth(1).locator("span span")).toHaveCount(2);
  for (const light of [false, true]) {
    await page.evaluate(
      (light) =>
        document.documentElement.classList.toggle("theme-light", light),
      light,
    );
    for (const index of [0, 1]) {
      const layout = await codes.nth(index).evaluate((code) => {
        const line = code.children[0];
        const blank = code.children[1];
        const body = code.closest('[data-streamdown="code-block-body"]')!;
        return {
          blank: blank.textContent,
          blankHeight: blank.getBoundingClientRect().height,
          lineHeight: line.getBoundingClientRect().height,
          counterReset: getComputedStyle(code).counterReset,
          counterContent: getComputedStyle(line, "::before").content,
          whiteSpace: getComputedStyle(code.parentElement!).whiteSpace,
          tokenColor: getComputedStyle(line.children[0]).color,
          bodyColor: getComputedStyle(body).color,
        };
      });
      expect(layout.blank).toBe("\n");
      expect(layout.blankHeight).toBeGreaterThan(0);
      expect(layout.blankHeight).toBe(layout.lineHeight);
      expect(layout.whiteSpace).toBe("pre");
      expect(layout.tokenColor).toBe(layout.bodyColor);
      expect(layout.counterReset).toBe(index ? "line 16" : "none");
      expect(layout.counterContent).toBe(index ? "counter(line)" : "none");
    }
  }
});

for (const mobile of [false, true]) {
  test(`paced prose settles without replay or remount (mobile=${mobile})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tests/browser/markdown-performance.html");
    await expect(page.locator(".agent-markdown")).toHaveText("Ready.");
    const source = "第一段包含 **强调内容**，后面的文字按词组淡入。".repeat(4) + "\n\nSecond paragraph with [a link](https://example.com).\n\nThird paragraph.\n\nTail";
    const update = (text: string, streaming: boolean) => page.evaluate(({ text, streaming }) => {
      (window as unknown as { showMarkdownExample(text: string, streaming: boolean): void }).showMarkdownExample(text, streaming);
    }, { text, streaming });
    // Reset the mounted reply, then deliver a fresh burst.
    await update("", true);
    await update(source, true);
    const markdown = page.locator(".agent-markdown");
    await expect(page.locator("[data-word-fade]").first()).toBeAttached();
    await expect(markdown).toContainText("Tail");
    await expect(page.locator("[data-word-fade]")).toHaveCount(0);
    const first = await markdown.locator("p").first().elementHandle();
    await update(source + " with more new words arriving here.", true);
    await expect(page.locator("[data-word-fade]").first()).toBeAttached();
    expect(await first!.evaluate(node => node.isConnected)).toBe(true);
    expect(await markdown.locator("p").first().locator("[data-word-fade]").count()).toBe(0);
    await update(source + " with more new words arriving here. Done.", false);
    await expect(markdown).toContainText("Done.");
    await expect(page.locator("[data-word-fade]")).toHaveCount(0);
    expect(await first!.evaluate(node => node.isConnected)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await update("", true);
    await update(source, true);
    await expect(markdown).toContainText("Tail");
    await expect(page.locator("[data-word-fade]")).toHaveCount(0);
  });
}

for (const mobile of [false, true]) {
  test(`live bursts stay bounded and completion catches up promptly (mobile=${mobile})`, async ({ page }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tests/browser/markdown-performance.html");
    await expect(page.locator(".agent-markdown")).toHaveText("Ready.");
    await page.evaluate(() => {
      (window as unknown as { showMarkdownExample(text: string, streaming: boolean): void }).showMarkdownExample("", true);
    });
    const markdown = page.locator(".agent-markdown");
    await expect(markdown).toHaveCount(0);
    await page.evaluate(() => {
      const node = document.querySelector("#root")!;
      const samples: { at: number; length: number }[] = [{ at: performance.now(), length: 0 }];
      const observer = new MutationObserver(() => {
        const length = node.querySelector(".agent-markdown")?.textContent?.length ?? 0;
        if (length !== samples.at(-1)!.length) samples.push({ at: performance.now(), length });
      });
      observer.observe(node, { subtree: true, childList: true, characterData: true });
      let completedAt = 0;
      Object.assign(window, { finishPacingSamples: () => { observer.disconnect(); return { samples, completedAt }; } });
      const update = (window as unknown as { showMarkdownExample(text: string, streaming: boolean): void }).showMarkdownExample;
      update("文".repeat(800), true);
      setTimeout(() => update("文".repeat(3200), true), 200);
      setTimeout(() => { completedAt = performance.now(); update("文".repeat(4000), false); }, 450);
    });
    await expect(markdown).toHaveText("文".repeat(4000), { timeout: 15000 });
    const { samples, completedAt } = await page.evaluate(() => (window as unknown as {
      finishPacingSamples(): { samples: { at: number; length: number }[]; completedAt: number };
    }).finishPacingSamples());
    const increments = samples.slice(1).map((sample, index) => ({
      at: sample.at,
      chars: sample.length - samples[index].length,
      elapsed: sample.at - samples[index].at,
    }));
    await testInfo.attach("display-speed", {
      body: JSON.stringify({ samples, increments }), contentType: "application/json",
    });
    const live = increments.filter(increment => increment.at < completedAt);
    expect(live.length).toBeGreaterThan(3);
    for (const increment of live) {
      expect(increment.chars).toBeGreaterThan(0);
      expect(increment.chars).toBeLessThanOrEqual(128);
    }
    expect(samples.at(-1)!.at - completedAt).toBeLessThan(1_000);
    await expect(page.locator("[data-word-fade]")).toHaveCount(0);
  });
}

test("a completed streamed reply catches up without losing Unicode or inline formatting", async ({ page }) => {
  await page.goto("/tests/browser/markdown-performance.html?wordFade");
  await expect(page.locator(".agent-markdown")).toContainText("Ready.");
  const body = "中文 e\u0301 👩‍💻 streamed prose. ".repeat(160);
  const text = `${body}\n\n[Read source](https://example.com/source)`;
  await page.evaluate((text) => {
    (window as unknown as { showMarkdownExample(text: string, streaming: boolean): void }).showMarkdownExample(text, true);
  }, text);
  await expect(page.locator(".agent-markdown")).toContainText("中文");
  await page.evaluate((text) => {
    (window as unknown as { showMarkdownExample(text: string, streaming: boolean): void }).showMarkdownExample(text, false);
  }, text);
  await expect(page.locator(".agent-markdown")).toHaveText(`${body.trimEnd()}Read source`, { timeout: 1_000 });
  await expect(page.getByRole("link", { name: "Read source" })).toHaveAttribute("href", "https://example.com/source");
  await expect(page.locator("[data-word-fade]")).toHaveCount(0);
});
