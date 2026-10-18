import { expect, test, type Page } from "@playwright/test";
import type { Block } from "../../src/features/sessions/model/session";

const history: Block[] = [
  { id: "history-user", role: "user", text: "Earlier prompt" },
  { id: "history-answer", role: "assistant", text: "Earlier answer." },
];
const first: Block = { id: "first", role: "user", text: "关闭本机显示器" };
const second: Block = { id: "second", role: "user", text: "测试输出两千字小说" };

async function render(page: Page, blocks: Block[]) {
  await page.evaluate(async (next) => {
    (window as unknown as { motionBlocks(blocks: Block[]): void }).motionBlocks(next);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }, blocks);
}

async function positions(page: Page) {
  return page.locator(".user-message-bubble:not([hidden])").evaluateAll((bubbles) =>
    bubbles.map((bubble) => {
      const box = bubble.getBoundingClientRect();
      const turn = bubble.closest<HTMLElement>(".transcript-turn")!;
      return {
        text: bubble.textContent,
        top: box.top,
        bottom: box.bottom,
        y: new DOMMatrix(getComputedStyle(bubble).transform).m42,
        turnY: new DOMMatrix(getComputedStyle(turn).transform).m42,
      };
    }),
  );
}

for (const anchor of [false, true]) {
  for (const reduced of [false, true]) {
    test(`consecutive prompts stay separated (anchor=${anchor}, reduced=${reduced})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await page.addInitScript((pin) => {
        localStorage.setItem("monocode.transcriptLayout", "chat");
        localStorage.setItem("monocode.transcriptAnchor", String(pin));
      }, anchor);
      await page.goto("/tests/browser/motion-migration.html");
      await page.waitForFunction(() => typeof (window as unknown as { motionBlocks?: unknown }).motionBlocks === "function");
      await render(page, history);
      await page.waitForTimeout(250);
      await render(page, [...history, { ...first, id: "sending:first", sending: true }]);
      await render(page, [...history, first]);
      await render(page, [...history, first, second]);
      await page.waitForTimeout(350);
      const samples = await positions(page);
      await testInfo.attach("bubble-positions", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath("consecutive-prompts.png"), fullPage: true });
      for (const sample of samples) {
        expect(sample.y, sample.text ?? "bubble").toBe(0);
        expect(sample.turnY, sample.text ?? "turn").toBe(0);
      }
      for (let i = 1; i < samples.length; i++)
        expect(samples[i].top - samples[i - 1].bottom).toBeGreaterThan(0);
    });
  }

  test(`hiding a moving prompt leaves no displacement when shown (anchor=${anchor})`, async ({ page }) => {
    await page.addInitScript((pin) => {
      localStorage.setItem("monocode.transcriptLayout", "chat");
      localStorage.setItem("monocode.transcriptAnchor", String(pin));
    }, anchor);
    await page.goto("/tests/browser/motion-migration.html");
    await page.waitForFunction(() => typeof (window as unknown as { motionBlocks?: unknown }).motionBlocks === "function");
    await render(page, history);
    await page.waitForTimeout(250);
    await render(page, [...history, first]);
    for (const visible of [false, true]) {
      await page.evaluate(async (value) => {
        (window as unknown as { motionTranscriptVisible(visible: boolean): void }).motionTranscriptVisible(value);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }, visible);
    }
    await page.waitForTimeout(250);
    for (const sample of await positions(page)) {
      expect(sample.y, sample.text ?? "bubble").toBe(0);
      expect(sample.turnY, sample.text ?? "turn").toBe(0);
    }
  });
}
