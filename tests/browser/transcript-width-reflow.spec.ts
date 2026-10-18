import { expect, test } from "@playwright/test";

test("keeps the latest reply pinned during width reflow and rapid reversal", async ({ page }) => {
  await page.goto("/tests/browser/markdown-performance.html");
  await page.waitForFunction(() => "showMarkdownExample" in window);
  await page.evaluate(() => {
    (window as unknown as { showMarkdownExample(text: string): void }).showMarkdownExample(
      Array.from({ length: 35 }, (_, index) =>
        `Paragraph ${index}: ${"Width changes should keep the last line in view while the panel moves. ".repeat(8)}`,
      ).join("\n\n"),
    );
  });
  const chat = page.locator(".agent-transcript");
  await expect(chat).toContainText("Paragraph 34:");
  await expect.poll(() => chat.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);

  const frames = await page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>(".agent-transcript")!;
    const root = document.getElementById("root")!;
    const frames: { width: number; gap: number; following?: string }[] = [];
    for (const width of [800, 700, 600, 500, 420, 500, 600, 700, 800, 850]) {
      root.style.width = `${width}px`;
      // The first frame performs layout; the next reads the painted result.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      frames.push({ width, gap: el.scrollHeight - el.clientHeight - el.scrollTop, following: el.dataset.followLatest });
    }
    return frames;
  });
  for (const frame of frames) {
    expect(frame.gap, `gap at ${frame.width}px`).toBeLessThanOrEqual(1);
    expect(frame.following).toBe("true");
  }

  // Reading history must not be turned back into following by a width change.
  await chat.hover();
  await page.mouse.wheel(0, -500);
  await expect(chat).toHaveAttribute("data-follow-latest", "false");
  await expect.poll(() => chat.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(100);
  await page.evaluate(() => { document.getElementById("root")!.style.width = "420px"; });
  await expect(chat).toHaveAttribute("data-follow-latest", "false");
  await expect.poll(() => chat.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(100);
});
