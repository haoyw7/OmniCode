// Run against the local Vite fixture server. No Host, provider, build or publication.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const output = 'build/desktop-pages';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ deviceScaleFactor: 1, timezoneId: 'UTC', locale: 'en-US' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = { browser: 'chromium', version: browser.version(), screenshots: [], checks: [], pages: [], errors };
const base = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1436';
const pages = (process.env.DESKTOP_PAGES || 'workflows,automations,notes,inbox,search').split(',');
const selector = name => `[data-app-${name}]`;

async function capture(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  results.screenshots.push(file);
}
async function verify(name, theme, width, lang, state) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const fixture = await page.evaluate(() => window.desktopPagesFixture);
  expect(fixture.unhandledCommands).toEqual([]);
  expect(errors).toEqual([]);
  if (name === 'workflows') expect(await page.locator(selector(name)).textContent()).not.toMatch(/automations\.time\./);
  results.pages.push({ page: name, theme, width, lang, state, rpc: [...new Set(fixture.rpcCalls)] });
  await capture(`${name}-${state}-${theme}-${width}-${lang}`);
}
async function open(name, theme, width = 1280, lang = 'en') {
  await page.setViewportSize({ width, height: width === 1280 ? 932 : 800 });
  await page.goto(`${base}/tests/browser/desktop-pages.html?page=${name}&theme=${theme}&lang=${lang}`);
  await page.locator(selector(name)).waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (name === 'workflows') await page.locator('[data-workflow-name="review-layout"]').first().waitFor();
  if (name === 'automations') await page.locator('button:not([role="switch"])[aria-label$="Daily workspace review"]').waitFor();
  if (name === 'notes') await page.locator('input').filter({ visible: true }).last().waitFor();
  if (name === 'inbox') await page.getByText('Preserve drafts when switching desktop modes', { exact: true }).first().waitFor();
  await page.waitForTimeout(350);
}

try {
  for (const theme of ['light', 'dark']) {
    for (const name of pages) {
      await open(name, theme);
      await verify(name, theme, 1280, 'en', 'home');
      if (name === 'workflows') {
        await page.locator('[data-workflow-name="review-layout"]').first().click();
        await expect(page.getByTestId('workflow-detail-description')).toHaveValue('Review the desktop workspace and record focused evidence.');
      } else if (name === 'automations') {
        await page.getByRole('button', { name: 'Open Daily workspace review', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Automation name' })).toHaveValue('Daily workspace review');
      } else if (name === 'notes') {
        await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Desktop layout notes');
        await page.getByRole('tab', { name: 'Source', exact: true }).click();
        await expect(page.getByPlaceholder('Write markdown…')).toHaveValue(/A quieter workspace/);
      } else if (name === 'inbox') {
        await page.getByText('Align navigation, composer and shared controls', { exact: true }).first().click();
        await page.getByRole('tab', { name: /^Checks/ }).click();
        await expect(page.getByText('Focused UI checks', { exact: true })).toBeVisible();
      } else if (name === 'search') {
        await page.getByRole('textbox', { name: 'Search', exact: true }).fill('layout');
        const conversation = page.getByRole('option').filter({ hasText: 'Desktop layout review' }).first();
        await expect(conversation).toBeVisible();
        const claudeIcon = await page.evaluate(async () => (await import('/src/features/sessions/ui/HarnessIcon.tsx')).HARNESS_ICONS.claude);
        await expect(conversation.locator('img')).toHaveAttribute('src', claudeIcon);
        await expect(conversation).not.toContainText('claude ·');
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(300);
      await verify(name, theme, 1280, 'en', 'detail');
      if (name === 'workflows') {
        await page.getByRole('tab', { name: /^Run history/ }).click();
        await expect(page.locator('[data-testid^="workflow-run-row-"]')).toBeVisible();
        await verify(name, theme, 1280, 'en', 'history');
      } else if (name === 'automations') {
        await page.getByRole('tab', { name: 'Run history', exact: true }).click();
        await expect(page.getByRole('button', { name: /Scheduled.*Succeeded/ })).toBeVisible();
        await verify(name, theme, 1280, 'en', 'history');
      }
    }
  }
  results.checks.push(`${pages.join(', ')} actual business pages in both themes at1280×932 with populated offline service data`);
  const detailChecks = { workflows: 'saved workflow detail/history', automations: 'automation editor/history', notes: 'note markdown source', inbox: 'Inbox PR checks', search: 'Search results with HarnessIcon and display title' };
  results.checks.push(pages.map(name => detailChecks[name]).join('; '));
  for (const name of pages) {
    await open(name, 'light', 800, 'zh-CN');
    await verify(name, 'light', 800, 'zh-CN', 'home');
    if (name === 'automations') {
      expect(await page.locator('.automation-template-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
      expect(await page.locator('[data-automation-columns]').evaluate(element => getComputedStyle(element).flexDirection)).toBe('column');
      expect(await page.locator('[data-automation-list]').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(200);
      await page.locator('button:not([role="switch"])[aria-label$="Daily workspace review"]').click();
      await expect(page.getByRole('textbox', { name: '自动化名称', exact: true })).toHaveValue('Daily workspace review');
      await verify(name, 'light', 800, 'zh-CN', 'editor');
    }
    if (name === 'notes') {
      expect(await page.locator('[data-notes-columns]').evaluate(element => getComputedStyle(element).flexDirection)).toBe('column');
      expect(await page.locator('[data-notes-list]').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(200);
      await page.getByRole('button', { name: /Verification checklist/ }).click();
      await expect(page.getByRole('textbox', { name: '笔记标题', exact: true })).toHaveValue('Verification checklist');
    }
  }
  results.checks.push(`${pages.length} actual business ${pages.length === 1 ? 'page' : 'pages'} at800×800 in Chinese; no document overflow`);
  results.checks.push('zero page errors and no unimplemented fixture RPC calls');
  if (pages.includes('workflows')) {
    await page.setViewportSize({ width: 1280, height: 932 });
    await page.goto(`${base}/tests/browser/desktop-pages.html?page=workflows&theme=light&collapsed`);
    const sidebar = page.locator('[data-sidebar-transition]');
    await sidebar.waitFor({ state: 'attached' });
    const width = () => sidebar.evaluate(element => element.getBoundingClientRect().width);
    const widths = { initial: await width() };
    expect(widths.initial).toBe(0);
    await page.locator('[data-window-drag-bar]').getByRole('button', { name: /Toggle Sidebar/ }).click();
    await page.waitForTimeout(50);
    widths.open50 = await width();
    expect(widths.open50).toBeGreaterThan(0); expect(widths.open50).toBeLessThan(288);
    await page.waitForTimeout(300);
    await page.locator('[data-window-navigation] button[aria-label^="Toggle Sidebar"]').click();
    await page.waitForTimeout(50);
    widths.close50 = await width();
    expect(widths.close50).toBeGreaterThan(0); expect(widths.close50).toBeLessThan(288);
    await page.locator('[data-window-drag-bar]').getByRole('button', { name: /Toggle Sidebar/ }).click();
    await page.waitForTimeout(300); expect(await width()).toBe(288);
    const handle = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
    const rect = await handle.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, 200); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 80, 200, { steps: 10 });
    await page.waitForTimeout(50);
    widths.drag = await width(); expect(widths.drag).toBe(368);
    await page.mouse.up(); await page.waitForTimeout(300);
    expect(await page.evaluate(() => localStorage.getItem('monocode.sidebarWidth'))).toBe('368');
    await page.locator('[data-window-navigation] button[aria-label^="Toggle Sidebar"]').click(); await page.waitForTimeout(300);
    expect(await width()).toBe(0);
    await page.locator('[data-window-drag-bar]').getByRole('button', { name: /Toggle Sidebar/ }).click(); await page.waitForTimeout(300);
    widths.restored = await width(); expect(widths.restored).toBe(368);
    const nextRect = await handle.boundingBox();
    await page.mouse.move(nextRect.x + nextRect.width / 2, 200); await page.mouse.down();
    await page.mouse.move(nextRect.x + nextRect.width / 2 + 40, 200, { steps: 4 }); await page.waitForTimeout(40);
    await page.locator('[data-window-navigation] button[aria-label^="Toggle Sidebar"]').evaluate(element => element.click());
    await page.waitForTimeout(300);
    expect(await width()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains('is-resizing'))).toBe(false);
    await page.mouse.up();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-window-drag-bar]').getByRole('button', { name: /Toggle Sidebar/ }).click(); await page.waitForTimeout(40);
    expect(await width()).toBe(408);
    await page.locator('[data-window-navigation] button[aria-label^="Toggle Sidebar"]').click(); await page.waitForTimeout(40);
    expect(await width()).toBe(0);
    results.sidebarWidths = widths;
    results.checks.push('sidebar initial zero width; 50ms opening/closing intermediates; rapid reversal; live pointer resize; preference restore; close during drag; reduced motion');
    await capture('sidebar-closed-after-drag-reduced-motion');
  }
  results.status = 'passed';
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  results.status = 'failed';
  results.failure = String(error.stack || error);
  throw error;
} finally {
  await fs.writeFile(`${output}/verification${process.env.DESKTOP_PAGES ? `-${pages.join('-')}` : ''}.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
