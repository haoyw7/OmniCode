import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const output = 'build/desktop-messaging';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const result = { browser: browser.version(), screenshots: [], checks: [], errors };
const base = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1441';
const ui = name => page.locator(`[data-ui="${name}"]`);
try {
  for (const dark of [false, true]) for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.goto(`${base}/tests/browser/desktop-messaging.html${dark ? '?dark' : ''}`);
    await ui('app-surface').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect(ui('navigation-item').first()).toHaveCSS('height', '36px');
    await expect(ui('navigation-icon').first()).toHaveCSS('width', '20px');
    await expect(ui('app-header').first()).toHaveCSS('min-height', '52px');
    await expect(ui('app-header').last()).toHaveCSS('min-height', '64px');
    await expect(ui('app-skeleton-avatar').first()).toHaveCSS('height', '32px');
    await expect(ui('app-skeleton-avatar').last()).toHaveCSS('height', '44px');
    await expect(ui('message-input').first()).toHaveCSS('height', '56px');
    await expect(ui('message-input').last()).toHaveCSS('border-radius', '16px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Projects', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Projects', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Compact projects' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Single-line draft' }).fill('A retained draft');
    await page.getByRole('button', { name: 'Expand preview' }).click();
    await expect(ui('app-surface').locator('[data-ui="app-header"]')).toHaveCSS('min-height', '64px');
    await expect(ui('app-skeleton-avatar').first()).toHaveCSS('height', '44px');
    await expect(page.getByRole('textbox', { name: 'Single-line draft' })).toHaveValue('A retained draft');
    await page.getByRole('button', { name: 'Expand preview' }).click();
    const screenshot = `${output}/${dark ? 'dark' : 'light'}-${width}.png`;
    await page.screenshot({ path: screenshot, fullPage: true }); result.screenshots.push(screenshot);
    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(ui('app-surface')).toHaveCount(0);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ui('app-skeleton-row').first()).toHaveCSS('animation-name', 'none');
  expect(errors).toEqual([]);
  result.checks.push('light/dark and 390/1100px geometry', 'navigation keyboard and disabled states', 'inline/multiline draft surfaces', 'inline/fullscreen app header and skeleton', 'expand/close callbacks preserve unrelated draft', 'static skeleton honors reduced motion', 'no horizontal overflow or page errors');
  await fs.writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
