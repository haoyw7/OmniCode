import { expect, test } from "@playwright/test";
import type { Block } from "../../src/features/sessions/model/session";

test("a write result and an automatic scroll adjustment do not release following", async ({ page }) => {
  await page.goto("/tests/browser/markdown-performance.html?activity");
  await page.waitForFunction(() => "showActivity" in window);
  const blocks: Block[] = [
    { id: "user", role: "user", text: "Write story.md" },
    ...Array.from({ length: 25 }, (_, i): Block => ({
      id: `read-${i}`, role: "tool", text: `Read chapter-${i}.md`,
      tool: { callId: `read-${i}`, kind: "read", status: "completed" },
    })),
    { id: "write", role: "tool", text: "Write story.md", streaming: true,
      tool: { callId: "write", kind: "write", status: "in_progress" } },
  ];
  const update = () => page.evaluate(blocks => {
    (window as unknown as { showActivity(blocks: Block[]): void }).showActivity(blocks);
  }, blocks);
  const chat = page.locator(".agent-transcript");
  const gap = () => chat.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
  await update();
  await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await expect.poll(gap).toBeLessThanOrEqual(1);
  blocks[blocks.length - 1] = {
    ...blocks.at(-1)!, streaming: false,
    tool: { callId: "write", kind: "write", status: "completed",
      preview: { kind: "write", path: "/fixture/story.md", contentOnly: true,
        additions: 1, lines: [{ kind: "add", number: 1, text: "A new story." }] } },
  };
  await update();
  await expect(chat.getByRole("button", { name: /Preview written content: story.md/ })).toBeVisible();
  await expect.poll(gap).toBeLessThanOrEqual(1);
  // Deliver a real browser scroll event with no reader gesture, as can happen
  // when result layout/focus changes adjust the offset. Do not fabricate wheel
  // input: that would intentionally pause following.
  await chat.evaluate(el => new Promise<void>(resolve => {
    el.addEventListener("scroll", () => resolve(), { once: true });
    el.scrollTop -= 40;
  }));
  await expect(chat).toHaveAttribute("data-follow-latest", "true");
  blocks.push({ id: "next-thought", role: "reasoning", text: "Now verify the written file.", streaming: true });
  await update();
  await expect.poll(gap).toBeLessThanOrEqual(1);
  await expect(chat).toHaveAttribute("data-follow-latest", "true");
});

test("desktop follows new tools and thoughts in the main chat, and respects reading history", async ({ page }) => {
  await page.goto("/tests/browser/markdown-performance.html?activity");
  await page.waitForFunction(() => "showActivity" in window);
  const blocks: Block[] = [{ id: "user", role: "user", text: "Investigate the project" }];
  let step = 0;
  const appendWork = async (count: number) => {
    for (let i = 0; i < count; i++, step++) {
      blocks.push(
        { id: `think-${step}`, role: "reasoning", text: `Checking part ${step}` },
        { id: `tool-${step}`, role: "tool", text: `Read part-${step}.ts`,
          tool: { callId: `tool-${step}`, kind: "read", status: "completed" } },
      );
    }
    await page.evaluate(blocks => {
      (window as unknown as { showActivity(blocks: Block[]): void }).showActivity(blocks);
    }, blocks);
  };
  const chat = page.locator(".agent-transcript");
  const top = () => chat.evaluate(el => el.scrollTop);
  const gap = () => chat.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);

  await appendWork(15);
  await expect.poll(top).toBeGreaterThan(200);
  await expect.poll(gap).toBeLessThanOrEqual(1);
  const previous = await top();
  await appendWork(4);
  await expect.poll(top).toBeGreaterThan(previous + 100);
  await expect.poll(gap).toBeLessThanOrEqual(1);

  await chat.hover();
  await page.mouse.wheel(0, -200);
  await expect(chat).toHaveAttribute("data-follow-latest", "false");
  // Wait for the actual wheel scroll to land before recording the reader's place.
  await expect.poll(gap).toBeGreaterThan(100);
  // WebKit smooths wheel input over several frames. Record the position only
  // after that native motion settles; otherwise the wheel itself moves it.
  await chat.evaluate(async el => {
    let previous = el.scrollTop;
    let stable = 0;
    for (let frame = 0; frame < 120 && stable < 6; frame++) {
      await new Promise(requestAnimationFrame);
      const next = el.scrollTop;
      stable = Math.abs(next - previous) < 0.1 ? stable + 1 : 0;
      previous = next;
    }
  });
  const reading = await top();
  await appendWork(3);
  await expect(chat.locator(".zen-phase-step")).toHaveCount(44);
  await expect.poll(gap).toBeGreaterThan(300);
  expect(await top()).toBeCloseTo(reading, 0);

  await page.mouse.wheel(0, 10000);
  await expect(chat).toHaveAttribute("data-follow-latest", "true");
  const resumed = await top();
  await appendWork(3);
  await expect.poll(top).toBeGreaterThan(resumed + 100);
  await expect.poll(gap).toBeLessThanOrEqual(1);
});
