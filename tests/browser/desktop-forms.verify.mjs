// Focused form verification against the offline fixture; no build or publication.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const output = 'build/desktop-forms';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1441';
const results = { browser: browser.version(), themes: {}, checks: [] };
const style = locator => locator.evaluate(node => {
  const css = getComputedStyle(node); const rect = node.getBoundingClientRect();
  return { height: rect.height, width: rect.width, radius: css.borderRadius, background: css.backgroundColor, color: css.color, opacity: css.opacity, shadow: css.boxShadow };
});
try {
  for (const theme of ['light', 'dark']) {
    await page.goto(`${base}/tests/browser/desktop-visual.html?theme=${theme}`);
    await page.getByRole('switch', { name: 'Switch', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const primary = page.getByRole('button', { name: 'Primary', exact: true });
    const danger = page.getByRole('button', { name: 'Danger', exact: true });
    const small = page.getByRole('button', { name: 'sm', exact: true });
    expect((await style(primary)).height).toBe(36);
    expect((await style(small)).height).toBe(32);
    expect((await style(small)).radius).toBe('6px');
    expect((await style(page.getByRole('button', { name: 'Secondary icon', exact: true }))).width).toBe(28);
    expect((await style(page.getByRole('button', { name: 'Default secondary icon', exact: true }))).width).toBe(32);
    const input = page.getByRole('textbox', { name: 'Long text', exact: true });
    expect((await style(input)).height).toBe(32);
    expect((await style(page.getByRole('textbox', { name: 'Large input', exact: true }))).height).toBe(40);
    expect((await style(page.getByRole('textbox', { name: 'Text area', exact: true }))).height).toBe(132);
    if (theme === 'light') {
      expect((await style(primary)).background).toBe('rgb(20, 20, 19)');
      expect((await style(danger)).background).toBe('rgb(181, 51, 51)');
      expect((await style(input)).background).toBe('rgb(255, 255, 255)');
    }
    await primary.focus();
    expect((await style(primary)).shadow).not.toBe('none');
    await danger.focus();
    expect((await style(danger)).shadow).not.toBe('none');
    await input.focus();
    expect((await style(input)).shadow).not.toBe('none');
    await input.fill('Edited with shared behavior');
    await expect(input).toHaveValue('Edited with shared behavior');
    const toggle = page.getByRole('switch', { name: 'Switch', exact: true });
    const thumb = toggle.locator('[data-slot="switch-thumb"]');
    const off = await thumb.boundingBox();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect.poll(async () => Math.round((await thumb.boundingBox()).x - off.x)).toBe(16);
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => Math.round((await thumb.boundingBox()).x - off.x)).toBe(0);
    const checkbox = page.getByRole('checkbox', { name: 'Shared checkbox', exact: true });
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    const radios = page.locator('[data-ui="radio"][name="controls-radio"]');
    await radios.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(1)).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Disabled switch', exact: true })).toBeDisabled();
    await expect.poll(async () => (await style(toggle)).background).toBe('rgb(70, 130, 213)');
    results.themes[theme] = { primary: await style(primary), danger: await style(danger), input: await style(input), switch: await style(toggle) };
    await page.screenshot({ path: `${output}/${theme}.png` });
  }
  const toggle = page.getByRole('switch', { name: 'Small switch', exact: true });
  await toggle.evaluate(node => node.setAttribute('dir', 'rtl'));
  const thumb = toggle.locator('[data-slot="switch-thumb"]');
  const off = await thumb.boundingBox();
  await toggle.click();
  await expect.poll(async () => Math.round((await thumb.boundingBox()).x - off.x)).toBe(-12);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => Math.round((await thumb.boundingBox()).x - off.x)).toBe(0);
  // Unmarked business controls must not acquire form geometry from utility classes/ARIA roles.
  const untouched = await page.evaluate(() => {
    const input = document.createElement('input'); input.className = 'border';
    const switchButton = document.createElement('button'); switchButton.setAttribute('role', 'switch');
    document.body.append(input, switchButton);
    const values = [getComputedStyle(input).borderRadius, getComputedStyle(switchButton).width];
    input.remove(); switchButton.remove(); return values;
  });
  expect(untouched).toEqual(['0px', '0px']);
  expect(errors).toEqual([]);
  results.checks.push('light/dark geometry and palette', 'keyboard switch, checkbox and radio selection', 'input edits and focus ring', 'disabled state', 'RTL small switch and reduced motion', 'unmarked controls remain isolated');
  await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
