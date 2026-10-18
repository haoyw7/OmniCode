// Production branch menus with offline Git data; no actual checkout or worktree creation.
import { chromium, webkit, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const output = 'build/branch-menu-reference';
const baseUrl = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1420';
const current = 'codex/motion-migration';
const names = [
  ...Array.from({ length: 20 }, (_, i) => `archive/branch-${String(i).padStart(2, '0')}`),
  'codex/bot-refactor', 'codex/bots-ui-redesign', 'codex/codex-pi-session-sync',
  'codex/desktop-evidence-optimizations', 'codex/desktop-question-ui',
  'codex/feishu-assistant-im', 'codex/git-graph-panel', 'codex/host-shared-state',
  'codex/mobile-performance', 'codex/mobile-performance-integration',
  'codex/mobile-url-client', current, 'codex/native-session-titles',
  'main', ...Array.from({ length: 15 }, (_, i) => `release/branch-${i}`),
];
await fs.mkdir(output, { recursive: true });
const report = { status: 'passed', baseUrl, scenes: [], errors: [] };

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium
    ? { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }
    : { headless: true });
  try {
    const theme = engine === chromium ? 'light' : 'dark';
    const page = await browser.newPage({ viewport: { width: 1280, height: 932 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${baseUrl}/tests/browser/desktop-visual.html?page=workspace&mode=code&state=empty&theme=${theme}&lang=en`);
    const root = page.locator('[data-composer-layout="desktop"]:visible').first();
    const draft = root.locator('textarea');
    await draft.fill('Branch menu draft 中文');
    await draft.evaluate(element => { window.branchMenuOriginalInput = element; });
    await page.evaluate(async ({ names, current }) => {
      const state = {
        current, detached: false,
        branches: [
          ...names.map(name => ({ name, current: name === current, remote: null })),
          { name: 'release', remote: 'origin', current: false },
        ],
      };
      const prior = window.__TAURI_INTERNALS__.invoke;
      window.branchMenuCheckoutCalls = [];
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command.includes('git_branches')) return Promise.resolve(state);
        if (command === 'git_checkout') window.branchMenuCheckoutCalls.push(args);
        return prior(command, args);
      };
      const { seedProjectBranches } = await import('/src/features/source-control/hooks/useProjectBranches.ts');
      seedProjectBranches(window.desktopFixture.getSession().cwd, state);
    }, { names, current });
    await page.evaluate(() => document.fonts.ready);

    const trigger = root.locator('.composer-current-branch button');
    await expect(trigger).toContainText(current);
    await trigger.click();
    const menu = page.locator('[data-branch-picker]:visible');
    const search = menu.locator('input');
    await expect(search).toBeFocused();
    await expect(menu.locator('[aria-selected="true"]')).toHaveAttribute('data-highlighted', 'true');

    async function inspect(label, surface, selectedName) {
      await expect(surface.locator('.branch-menu-viewport')).toHaveAttribute('data-scroll-above', 'true');
      // Wait for the shared 200ms popover transition before measuring/capturing.
      await expect.poll(() => surface.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
      const geometry = await surface.evaluate(el => {
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const scroll = el.querySelector('.branch-menu-scroll');
        const row = el.querySelector('[aria-selected="true"]');
        const field = el.querySelector('.branch-menu-search');
        const mark = row.querySelector('.branch-menu-check');
        return {
          frame: rect(el.closest('.popover-frame')), scroll: rect(scroll), search: rect(field), row: rect(row), check: rect(mark),
          scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
          rowHeights: [...el.querySelectorAll('[role="option"]')].map(node => node.getBoundingClientRect().height),
          radius: getComputedStyle(row).borderRadius, fontWeight: getComputedStyle(row.querySelector('span')).fontWeight,
          leadingIconsHidden: [...el.querySelectorAll('.branch-menu-icon')].every(icon => getComputedStyle(icon).display === 'none'),
          checkColor: getComputedStyle(mark).color, accent: getComputedStyle(el).getPropertyValue('--color-accent').trim(),
          selectedRows: [...el.querySelectorAll('[role="option"]')].filter(node => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
          active: el.querySelector('[data-highlighted="true"]').textContent,
        };
      });
      expect(geometry.frame.width).toBe(320);
      expect(geometry.frame.height).toBe(360);
      expect(geometry.search.height).toBe(26);
      expect(new Set(geometry.rowHeights)).toEqual(new Set([24]));
      expect(geometry.radius).toBe('6px');
      expect(geometry.fontWeight).toBe('400');
      expect(geometry.leadingIconsHidden).toBe(true);
      expect(geometry.selectedRows).toBe(1);
      expect(geometry.check.width).toBe(14);
      expect(geometry.checkColor).toBe('rgb(42, 120, 214)');
      expect(geometry.row.y).toBeGreaterThanOrEqual(geometry.scroll.y);
      expect(geometry.row.bottom).toBeLessThanOrEqual(geometry.scroll.bottom);
      expect(geometry.search.y).toBeGreaterThanOrEqual(geometry.scroll.bottom);
      expect(geometry.check.x).toBeGreaterThan(geometry.row.right - 32);
      expect(geometry.active).toBe(selectedName);
      const screenshot = `${engine.name()}-${theme}-${label}.png`;
      const frame = geometry.frame;
      await page.mouse.move(geometry.scroll.right - 2, geometry.scroll.y + geometry.scroll.height / 2);
      await page.screenshot({ path: `${output}/${screenshot}`, clip: { x: frame.x - 4, y: frame.y - 4, width: frame.width + 8, height: frame.height + 44 } });
      report.scenes.push({ browser: engine.name(), version: browser.version(), theme, label, screenshot, geometry });
      // Hovering the last visible row must not make a long list scroll itself.
      const beforeHover = await surface.locator('.branch-menu-scroll').evaluate(el => el.scrollTop);
      await page.mouse.move(geometry.scroll.x + 50, geometry.scroll.bottom - 12);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await surface.locator('.branch-menu-scroll').evaluate(el => el.scrollTop)).toBe(beforeHover);
      await page.mouse.move(0, 0);
    }

    await inspect('checkout', menu, current);
    const thumb = menu.locator('.branch-menu-scroll-thumb');
    const thumbRect = await thumb.boundingBox();
    const initialScrollTop = await menu.locator('.branch-menu-scroll').evaluate(el => el.scrollTop);
    await page.mouse.move(thumbRect.x + thumbRect.width / 2, thumbRect.y + thumbRect.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumbRect.x + thumbRect.width / 2, thumbRect.y + thumbRect.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => menu.locator('.branch-menu-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(initialScrollTop);
    const searchBefore = await search.boundingBox();
    await menu.locator('.branch-menu-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(menu.locator('.branch-menu-viewport')).toHaveAttribute('data-scroll-below', 'false');
    expect(await search.boundingBox()).toEqual(searchBefore);
    await expect(menu.getByRole('button', { name: 'New branch', exact: true })).toBeInViewport();
    await search.fill('origin');
    await expect(menu.getByRole('option')).toHaveCount(1);
    await expect(menu.getByRole('option')).toContainText('release');
    await search.fill('');
    await expect(menu.locator('[data-highlighted="true"]')).toHaveText(current);
    await search.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => window.branchMenuCheckoutCalls)).toEqual([]);
    await expect(draft).toBeFocused();

    // Worktree base dropdown shares the geometry and retains remote references.
    await root.locator('.composer-worktree-checkbox input').check();
    const base = root.locator('.composer-worktree-base > button');
    await expect(base).toHaveText('main');
    await base.click();
    const baseMenu = page.getByRole('dialog', { name: 'Worktree base branch', exact: true });
    await expect(baseMenu.locator('input')).toBeFocused();
    await inspect('worktree-base', baseMenu, 'main');
    await baseMenu.locator('input').fill('origin/release');
    await baseMenu.locator('input').press('Enter');
    await expect(base).toHaveText('origin/release');
    await expect.poll(() => page.evaluate(() => window.desktopFixture.getSession().worktreeBase)).toBe('origin/release');
    await expect(draft).toHaveValue('Branch menu draft 中文');
    expect(await draft.evaluate(element => element === window.branchMenuOriginalInput)).toBe(true);
    expect(await page.evaluate(() => window.branchMenuCheckoutCalls)).toEqual([]);

    // Narrow and short window: the footer stays inside the constrained frame.
    await page.setViewportSize({ width: 640, height: 240 });
    await base.click();
    const short = page.getByRole('dialog', { name: 'Worktree base branch', exact: true });
    await expect(short.locator('input')).toBeFocused();
    await expect.poll(() => short.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
    const shortGeometry = await short.evaluate(el => {
      const frame = el.closest('.popover-frame').getBoundingClientRect();
      const field = el.querySelector('input').getBoundingClientRect();
      return { frameTop: frame.top, frameBottom: frame.bottom, frameHeight: frame.height, fieldTop: field.top, fieldBottom: field.bottom, viewportHeight: innerHeight };
    });
    expect(shortGeometry.frameTop).toBeGreaterThanOrEqual(0);
    expect(shortGeometry.frameBottom).toBeLessThanOrEqual(240);
    expect(shortGeometry.fieldBottom).toBeLessThanOrEqual(shortGeometry.frameBottom);
    await page.setViewportSize({ width: 1280, height: 932 });
    await expect.poll(() => short.evaluate(el => el.closest('.popover-frame').getBoundingClientRect().height)).toBe(360);
    await short.locator('input').press('Escape');
    await expect(base).toHaveAttribute('aria-expanded', 'false');
    await expect(draft).toBeFocused();
    report.scenes.push({ browser: engine.name(), theme, label: 'short-window', geometry: shortGeometry, searchFixedDuringScroll: true, scrollbarDrag: true, resizeRestoresFullHeight: true, escapeRestoresFocus: true, retainedDraft: true, baseSelection: 'origin/release', checkoutCalls: 0 });
  } finally {
    await browser.close();
  }
}
expect(report.errors).toEqual([]);
await fs.writeFile(`${output}/verification.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
