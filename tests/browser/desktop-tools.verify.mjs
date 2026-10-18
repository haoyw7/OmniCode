// Targeted real project-tools/xterm QA against Vite. Native RPC is simulated; no build.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const output = 'build/desktop-tools-visual';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ deviceScaleFactor: 1, timezoneId: 'UTC' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const result = { browser: 'chromium', version: browser.version(), dpr: 1, rpc: 'simulated offline data; real UI components', screenshots: [], checks: [], geometry: {}, errors };
const fixture = `${process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1436'}/tests/browser/desktop-tools.html`;
const terminal = page.locator('.xterm');
const composer = page.locator('.composer-field');
async function capture(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  result.screenshots.push(file);
}
async function measure(selector) {
  return page.locator(selector).first().evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: style.borderRadius, fontSize: style.fontSize, lineHeight: style.lineHeight };
  });
}
async function nativeCalls(command) {
  return page.evaluate(command => window.toolsFixture.rpc.filter(call => call.command === command), command);
}
async function ready() {
  await expect(page.locator('[data-git-review-pane]')).toBeVisible();
  await expect(page.locator('[data-project-tools-panel="files"]')).toContainText('workspace.ts');
  await expect(page.locator('.xterm-rows')).toContainText('git status --short');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

try {
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 932 });
    await page.goto(`${fixture}?theme=${theme}`);
    await ready();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    result.geometry[`${theme}-combined`] = Object.fromEntries(await Promise.all(['[data-sidebar-transition]', '.desktop-tools-panel', '.desktop-tools-workspace', '[data-pane-id="tools-editor"]', '[data-git-review-pane]', '[data-surface-tab-strip]', '.project-terminal-card', '.composer-field'].map(async selector => [selector, await measure(selector)])));
    const tools = result.geometry[`${theme}-combined`]['.desktop-tools-panel'];
    const dockCard = result.geometry[`${theme}-combined`]['.project-terminal-card'];
    result.geometry[`${theme}-combined`].toolsGrid = await page.locator('.desktop-tools-layout').evaluate(element => ({ tracks: getComputedStyle(element).gridTemplateColumns, marginRight: getComputedStyle(element.querySelector('.desktop-tools-panel')).marginRight }));
    expect(result.geometry[`${theme}-combined`].toolsGrid.tracks.split(' ').at(-1)).toBe('288px');
    expect(result.geometry[`${theme}-combined`].toolsGrid.marginRight).toBe('12px');
    expect(result.geometry[`${theme}-combined`]['.desktop-tools-panel'].width).toBeCloseTo(276, 0);
    expect(tools.height).toBeGreaterThan(dockCard.height * 3);
    expect(dockCard.x + dockCard.width).toBeLessThan(tools.x);
    expect(tools.y + tools.height).toBeCloseTo(dockCard.y + dockCard.height, 0);
    const workspace = result.geometry[`${theme}-combined`]['.desktop-tools-workspace'];
    const lastLeaf = result.geometry[`${theme}-combined`]['[data-pane-id="tools-editor"]'];
    expect(lastLeaf.x + lastLeaf.width).toBeCloseTo(workspace.x + workspace.width, 0);
    expect(result.geometry[`${theme}-combined`]['[data-surface-tab-strip]'].height).toBeCloseTo(32, 1);
    expect((await nativeCalls('git_file_diff')).length).toBeGreaterThan(0);
    const resize = (await nativeCalls('pty_resize')).at(-1).args;
    expect(resize.cols).toBeGreaterThan(50);
    expect(resize.rows).toBeGreaterThan(5);
    await capture(`code-${theme}-files-review-terminal-1440`);

    await composer.fill('Keep this draft while switching project tools.');
    await composer.evaluate(element => element.dataset.retained = 'composer');
    await terminal.evaluate(element => element.dataset.retained = 'terminal');
    await page.evaluate(() => window.toolsFixture.setTab('changes'));
    await expect(page.locator('[data-project-tools-panel="changes"]')).toContainText('Staged Changes');
    await expect(page.locator('[data-project-tools-panel="changes"]')).toContainText('Refine workspace spacing');
    await expect(page.locator('[data-project-tools-panel="files"]')).toBeHidden();
    await expect(composer).toHaveValue('Keep this draft while switching project tools.');
    await expect(terminal).toHaveAttribute('data-retained', 'terminal');
    await page.evaluate(() => window.toolsFixture.selectFile('tools-source'));
    const editor = page.locator('.cm-content[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('preserveSessions: true');
    await editor.evaluate(element => element.dataset.retained = 'editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('// Editor draft retained\n');
    await capture(`code-${theme}-source-control-editor-terminal-1440`);

    await page.evaluate(() => { window.toolsFixture.setTab('files'); window.toolsFixture.selectFile('tools-review'); });
    await expect(page.locator('[data-project-tools-panel="files"]')).toBeVisible();
    await expect(page.locator('[data-git-review-pane]')).toBeVisible();
    await page.evaluate(() => window.toolsFixture.selectFile('tools-source'));
    await expect(editor).toHaveAttribute('data-retained', 'editor');
    await expect(editor).toContainText('Editor draft retained');
    await expect(composer).toHaveAttribute('data-retained', 'composer');
    expect(await nativeCalls('pty_spawn')).toHaveLength(1);
    expect(await nativeCalls('pty_kill')).toHaveLength(0);
    result.checks.push(`${theme}: production nesting keeps Files full-height and terminal confined to workspace; tools track288 includes margin12 so visible panel276; real conversation + FilePane Changes review + xterm coexist; SourceControl/CodeMirror render and tool/tab switching retains nodes`);

    await page.evaluate(() => window.toolsFixture.setTerminalOpen(false));
    const dock = page.locator('[data-terminal-dock-layout]');
    await expect(dock).toHaveAttribute('data-fold-state', 'closing');
    await expect(page.locator('[data-project-terminal-dock]')).toHaveJSProperty('inert', false);
    await expect(page.locator('[data-project-terminal-dock]').locator('..')).toHaveAttribute('inert', '');
    await expect(dock).toHaveAttribute('data-fold-state', 'closed');
    await expect(terminal).toBeHidden();
    expect(await nativeCalls('pty_kill')).toHaveLength(0);
    await page.evaluate(() => window.toolsFixture.output('\r\nretained-output-while-hidden\r\n$ '));
    await page.evaluate(() => window.toolsFixture.setTerminalOpen(true));
    await expect(dock).toHaveAttribute('data-fold-state', 'open');
    await expect(terminal).toHaveAttribute('data-retained', 'terminal');
    await expect(page.locator('.xterm-rows')).toContainText('retained-output-while-hidden');
    expect(await nativeCalls('pty_spawn')).toHaveLength(1);
    await page.evaluate(() => window.toolsFixture.setTerminalOpen(false));
    await page.waitForTimeout(40);
    await page.evaluate(() => window.toolsFixture.setTerminalOpen(true));
    await expect(dock).toHaveAttribute('data-fold-state', 'open');
    await expect(terminal).toHaveAttribute('data-retained', 'terminal');
    result.checks.push(`${theme}: terminal closes inert, stays mounted without PTY kill, receives hidden output, reopens without respawn, and handles rapid reversal`);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.toolsFixture.setTerminalOpen(false));
    await expect(dock).toHaveAttribute('data-fold-state', 'closed');
    await page.evaluate(() => window.toolsFixture.setTerminalOpen(true));
    await expect(dock).toHaveAttribute('data-fold-state', 'open');
    await expect(terminal).toHaveAttribute('data-retained', 'terminal');
    await page.evaluate(() => { window.toolsFixture.setSidebarOpen(false); window.toolsFixture.selectFile('tools-review'); });
    await expect(page.locator('[data-sidebar-transition]')).toHaveAttribute('data-fold-state', 'closed');
    await page.waitForTimeout(100);
    await capture(`code-${theme}-files-review-terminal-sidebar-closed-1440`);
    await page.setViewportSize({ width: 1280, height: 932 });
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('[data-project-tools-panel="files"]')).toBeVisible();
    await expect(page.locator('[data-git-review-pane]')).toBeVisible();
    await expect(page.locator('.xterm-rows')).toContainText('retained-output-while-hidden');
    await capture(`code-${theme}-files-review-terminal-reduced-motion-1280`);
    expect(await nativeCalls('pty_spawn')).toHaveLength(1);
    expect(await nativeCalls('pty_kill')).toHaveLength(0);
    result.checks.push(`${theme}: reduced-motion terminal hide/reveal and sidebar collapse retain all surfaces; combined layout has no document overflow at1280×932`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  expect(errors).toEqual([]);
  await fs.writeFile(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ version: result.version, screenshots: result.screenshots.length, checks: result.checks.length, errors }, null, 2));
} finally {
  await browser.close();
}
