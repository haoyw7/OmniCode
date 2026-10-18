// Offline production composer: selection persists a source without checking out Git.
import { chromium, webkit, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const output = 'build/worktree-main';
const baseUrl = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1420';
await fs.mkdir(output, { recursive: true });
const report = { status: 'passed', baseUrl, scenes: [], errors: [] };

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium
    ? { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }
    : { headless: true });
  try {
    const theme = engine === chromium ? 'light' : 'dark';
    const page = await browser.newPage({ viewport: { width: 1280, height: 932 } });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${baseUrl}/tests/browser/desktop-visual.html?page=workspace&mode=code&state=empty&theme=${theme}&lang=en`);
    const root = page.locator('[data-composer-layout="desktop"]:visible').first();
    await root.locator('textarea').waitFor();
    await page.evaluate(async () => {
      const state = {
        current: 'feature/current', detached: false,
        branches: [
          { name: 'feature/current', current: true, remote: null },
          { name: 'main', current: false, remote: null },
          { name: 'release', current: false, remote: null },
        ],
      };
      const prior = window.__TAURI_INTERNALS__.invoke;
      window.fixtureCheckoutCalls = [];
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command.includes('git_branches')) return Promise.resolve(state);
        if (command === 'git_checkout') window.fixtureCheckoutCalls.push(args);
        return prior(command, args);
      };
      const { seedProjectBranches } = await import('/src/features/source-control/hooks/useProjectBranches.ts');
      seedProjectBranches(window.desktopFixture.getSession().cwd, state);
    });
    await expect(root.locator('.composer-current-branch button')).toContainText('feature/current');
    const input = root.locator('textarea');
    await input.fill('Keep this unsent draft. 中文草稿');
    await input.evaluate(element => { window.fixtureOriginalField = element; });
    const check = root.locator('.composer-worktree-checkbox input');
    await check.check();
    await expect.poll(() => page.evaluate(() => window.desktopFixture.getSession().worktreeBase)).toBe('main');
    const base = root.locator('.composer-worktree-base > button');
    await expect(base).toHaveText('main');
    await page.evaluate(() => document.fonts.ready);
    const left = await base.boundingBox(), right = await root.locator('.composer-worktree-checkbox').boundingBox();
    await page.mouse.move(0, 0);
    const crop = `${engine.name()}-${theme}-main.png`;
    await page.screenshot({ path: `${output}/${crop}`, clip: {
      x: left.x - 2, y: left.y - 2, width: left.width + right.width + 4,
      height: Math.max(left.height, right.height) + 4,
    } });
    await base.click();
    await page.getByRole('option', { name: 'release', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopFixture.getSession().worktreeBase)).toBe('release');
    await expect(base).toHaveText('release');
    await check.uncheck();
    await expect(root.locator('.composer-current-branch button')).toContainText('feature/current');
    await expect.poll(() => page.evaluate(() => window.desktopFixture.getSession().worktreeBase)).toBe(undefined);
    await check.check();
    await expect.poll(() => page.evaluate(() => window.desktopFixture.getSession().worktreeBase)).toBe('main');
    await expect(input).toHaveValue('Keep this unsent draft. 中文草稿');
    expect(await input.evaluate(element => element === window.fixtureOriginalField)).toBe(true);
    expect(await page.evaluate(() => window.fixtureCheckoutCalls)).toEqual([]);
    report.scenes.push({
      browser: engine.name(), version: browser.version(), theme, crop,
      currentBranch: 'feature/current', defaultBase: 'main', manualBase: 'release',
      uncheckRestoresCurrent: true, recheckDefaultsToMain: true, retainedDraft: true, checkoutCalls: 0,
    });
  } finally {
    await browser.close();
  }
}
expect(report.errors).toEqual([]);
await fs.writeFile(`${output}/verification.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
