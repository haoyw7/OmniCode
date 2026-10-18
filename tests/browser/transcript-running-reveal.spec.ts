import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/styles/index.css", import.meta.url), "utf8");
let fixture: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { AnimatedCollapse } from './src/shared/ui/AnimatedCollapse';
        const root = createRoot(document.getElementById('root'));
        window.showRunning = (expanded) => flushSync(() => root.render(
          createElement('div', { className: 'transcript-turn' },
            createElement(AnimatedCollapse, { expanded },
              createElement('span', { id: 'running' }, 'GPT-6-Astra 正在运行…')))));
        window.showRunning(false);
      `,
      resolveDir: process.cwd(),
    },
    bundle: true, format: "iife", write: false,
  });
  fixture = result.outputFiles[0].text;
});

test("send acknowledgement reveals the running row once without restarting its collapse animation", async ({ page }) => {
  await page.setContent(`<style>${css}
    :root { --motion-ease-out: cubic-bezier(0.22, 1, 0.36, 1); }
  </style><div id="root"></div>`);
  await page.addScriptTag({ content: fixture });
  const samples = await page.evaluate(async () => {
    const turn = document.querySelector<HTMLElement>(".transcript-turn")!;
    turn.dataset.promptRise = "rising";
    (window as unknown as { showRunning(expanded: boolean): void }).showRunning(true);
    const row = document.querySelector<HTMLElement>(".zen-fold-item")!;
    const running = document.getElementById("running")!;
    const opacity = () => {
      let value = 1;
      for (let node: HTMLElement | null = running; node; node = node.parentElement)
        value *= Number(getComputedStyle(node).opacity);
      return value;
    };
    const sample = async (duration: number) => {
      const values: number[] = [];
      const start = performance.now();
      await new Promise<void>(resolve => {
        const frame = () => {
          values.push(opacity());
          if (performance.now() - start < duration) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return values;
    };
    const rising = await sample(100);
    const opening = row.getAnimations()[0];
    turn.dataset.promptRise = "revealing";
    // Reading forces style resolution: a conflicting animation would cancel opening.
    opacity();
    const keptOpening = row.getAnimations().includes(opening);
    const reveal = await sample(180);
    delete turn.dataset.promptRise;
    const settled = await sample(300);
    return { rising, reveal: [...reveal, ...settled], keptOpening,
      sameNode: document.getElementById("running") === running,
      state: row.dataset.foldState };
  });
  expect(Math.max(...samples.rising)).toBeLessThan(0.01);
  expect(samples.keptOpening).toBe(true);
  expect(samples.sameNode).toBe(true);
  expect(samples.state).toBe("open");
  expect(samples.reveal.at(-1)).toBe(1);
  for (let index = 1; index < samples.reveal.length; index++)
    expect(samples.reveal[index] - samples.reveal[index - 1]).toBeGreaterThanOrEqual(-0.02);
});
