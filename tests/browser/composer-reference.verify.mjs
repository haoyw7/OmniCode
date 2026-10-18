// Focused offline verification of the production Composer and retained workspace.
// Run only after desktop-visual.html is ready on the local Vite fixture server.
import { chromium, webkit, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const engine = process.env.VISUAL_BROWSER === 'webkit' ? webkit : chromium;
const output = `build/composer-reference${engine === webkit ? '-webkit' : ''}`;
const base = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1436';
const fixture = `${base}/tests/browser/desktop-visual.html`;
await fs.mkdir(output, { recursive: true });
const browser = await engine.launch(engine === chromium ? { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] } : { headless: true });
const results = { browser: engine.name(), version: browser.version(), screenshots: [], scenes: [], checks: [], errors: [] };

function near(actual, expected, tolerance = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}
const centerY = box => box.y + box.h / 2;
const right = box => box.x + box.w;
const bottom = box => box.y + box.h;
function intersection(a, b) {
  return Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
}

async function open({ width = 1280, height = 932, theme = 'light', lang = 'en', mode = 'code', state = 'empty', dpr = 1, fontSize = 14 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, timezoneId: 'UTC' });
  const page = await context.newPage();
  page.on('pageerror', error => results.errors.push(error.message));
  // Set the same preference variables before mount, so textarea measurement
  // uses the enlarged type on its first layout rather than a stale inline size.
  await page.addInitScript(size => {
    localStorage.setItem('monocode.uiFontSize', String(size));
    localStorage.setItem('monocode.contentFontSize', String(size));
    const apply = () => {
      if (!document.documentElement) return false;
      for (const name of ['--ui-font-scale', '--content-font-scale', '--font-scale']) document.documentElement.style.setProperty(name, String(size / 14));
      return true;
    };
    if (!apply()) {
      const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
      observer.observe(document, { childList: true, subtree: true });
    }
  }, fontSize);
  await page.goto(`${fixture}?page=workspace&mode=${mode}&state=${state}&theme=${theme}&lang=${lang}`);
  await page.locator('[data-composer-layout="desktop"] textarea:visible').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  return { context, page, options: { width, height, theme, lang, mode, state, dpr, fontSize } };
}

async function measure(composer) {
  return composer.evaluate(root => {
    const box = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      return { x: r.x, y: r.y, w: r.width, h: r.height, display: s.display, font: s.fontSize, line: s.lineHeight, position: s.position, overflowX: s.overflowX };
    };
    const context = root.querySelector('[data-composer-context]');
    const model = root.querySelector('[data-model-picker-trigger]');
    const modelControls = root.querySelector('.composer-model-controls');
    const buttons = modelControls ? [...modelControls.querySelectorAll('button')].filter(button => !context?.contains(button) && button.getBoundingClientRect().width > 0) : [];
    const lastModel = buttons.sort((a, b) => a.getBoundingClientRect().right - b.getBoundingClientRect().right).at(-1) ?? model;
    const top = root.querySelector('.composer-workspace-bar');
    const footerParts = [root.querySelector('.composer-plus'), root.querySelector('.composer-toolbar'), context].filter(Boolean).map(box);
    const footer = footerParts.length ? { x: Math.min(...footerParts.map(b => b.x)), y: Math.min(...footerParts.map(b => b.y)), w: Math.max(...footerParts.map(b => b.x + b.w)) - Math.min(...footerParts.map(b => b.x)), h: Math.max(...footerParts.map(b => b.y + b.h)) - Math.min(...footerParts.map(b => b.y)) } : null;
    return {
      composer: box(root), dock: box(root.closest('.desktop-composer-dock') ?? root), top: box(top),
      environment: box(top?.querySelector('.composer-environment-badge')), project: box(top?.querySelector('.composer-project-picker')),
      shell: box(root.querySelector('[data-ui="message-input"]')), field: box(root.querySelector('textarea')),
      footer, toolbar: box(root.querySelector('.composer-toolbar')),
      meta: box(root.querySelector('.composer-meta')), plus: box(root.querySelector('.composer-plus')),
      access: box(root.querySelector('[data-access-picker-trigger]')), model: box(model), lastModel: box(lastModel), context: box(context),
      send: box(root.querySelector('.composer-send, .composer-stop')),
      contextInTop: !!(context && top?.contains(context)),
      topButtonCount: top ? [...top.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0).length : 0,
      topCheckboxCount: top ? top.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length : 0,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

async function hitTest(locator) {
  expect(await locator.evaluate(button => {
    const r = button.getBoundingClientRect();
    // Keep corner samples inside the existing Chat button's 8px rounding.
    return [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 4, r.y + 4], [r.right - 4, r.bottom - 4]].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === button || button.contains(hit));
    });
  })).toBe(true);
}

async function verifyCode(composer, { baseline = false, hit = true, draftControls = true } = {}) {
  const g = await measure(composer);
  for (const key of ['dock', 'top', 'environment', 'project', 'shell', 'field', 'footer', 'plus', 'access', 'model', 'lastModel', 'context', 'send']) expect(g[key], key).not.toBeNull();
  if (baseline) near(g.dock.w, 800);
  expect(bottom(g.top)).toBeLessThanOrEqual(g.shell.y + 1);
  expect(g.footer.y).toBeGreaterThanOrEqual(bottom(g.shell) - 1);
  expect(g.contextInTop).toBe(false);
  expect(g.environment.w).toBeGreaterThan(0); expect(g.project.w).toBeGreaterThan(0);
  expect(g.topButtonCount).toBeGreaterThanOrEqual(2);
  if (draftControls) expect(g.topCheckboxCount).toBeGreaterThanOrEqual(1);
  const row = [g.plus, g.access, g.model, g.context];
  expect(Math.max(...row.map(centerY)) - Math.min(...row.map(centerY))).toBeLessThanOrEqual(4);
  expect(g.footer.h).toBeLessThanOrEqual(Math.max(...row.map(box => box.h)) + 12);
  expect(g.plus.w).toBeGreaterThanOrEqual(20); expect(g.plus.h).toBeGreaterThanOrEqual(20);
  for (const other of [g.access, g.model, g.context]) expect(intersection(g.plus, other)).toBeLessThanOrEqual(.1);
  expect(g.context.x - right(g.lastModel)).toBeGreaterThanOrEqual(-1);
  expect(g.context.x - right(g.lastModel)).toBeLessThanOrEqual(16);
  expect(g.field.h).toBeGreaterThanOrEqual(parseFloat(g.field.line) - 1);
  expect(g.documentOverflow).toBe(false);
  if (hit) await hitTest(composer.locator('.composer-plus'));
  return g;
}

async function capture(page, name) {
  const file = `${name}.png`;
  const png = await page.screenshot({ path: `${output}/${file}` });
  results.screenshots.push(file);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function verifyPickerFocus(page, composer) {
  const field = composer.locator('textarea');
  const cases = [
    ['project', composer.locator('.composer-workspace-trigger').first(), '[data-cwd-picker]'],
    ['branch', composer.locator('.composer-current-branch button'), '[data-branch-picker]'],
    ['worktree', composer.locator('.composer-worktree-menu-trigger'), '[data-workspace-picker]'],
    ['access', composer.locator('[data-access-picker-trigger]'), '[data-access-picker]'],
    ['model', composer.locator('[data-model-picker-trigger]'), '[data-model-picker]'],
  ];
  for (const [name, trigger, popup] of cases) {
    await field.focus(); await trigger.click();
    await page.locator(popup).last().waitFor();
    await page.keyboard.press('Escape');
    await expect(page.locator(popup)).toHaveCount(0);
    await expect(field, `${name} Escape restores textarea focus`).toBeFocused();
  }
}

async function verifyModeRetention(page) {
  const field = () => page.locator('[data-composer-layout="desktop"] textarea:visible');
  await field().fill('Code draft retained across mode changes. 中文草稿');
  await field().evaluate(element => { window.composerReferenceCodeField = element; });
  await page.evaluate(() => window.desktopFixture.setMode('chat'));
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.desktopMode)).toBe('chat');
  await field().fill('Independent Chat draft.');
  await field().evaluate(element => { window.composerReferenceChatField = element; });
  await page.evaluate(() => window.desktopFixture.setMode('code'));
  await expect(field()).toHaveValue('Code draft retained across mode changes. 中文草稿');
  expect(await field().evaluate(element => element === window.composerReferenceCodeField)).toBe(true);
  await page.evaluate(() => window.desktopFixture.setMode('chat'));
  await expect(field()).toHaveValue('Independent Chat draft.');
  expect(await field().evaluate(element => element === window.composerReferenceChatField)).toBe(true);
}

async function verifyWorktreeControl(composer) {
  const field = await composer.locator('textarea').elementHandle();
  const checkbox = composer.locator('.composer-worktree-checkbox input');
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(composer.locator('.composer-worktree-base')).toBeVisible();
  expect(await field.evaluate(element => element.isConnected)).toBe(true);
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect(composer.locator('.composer-current-branch')).toBeVisible();
}

try {
  for (const theme of ['light', 'dark']) {
    const run = await open({ theme });
    const composer = run.page.locator('[data-composer-layout="desktop"]:visible');
    const geometry = await verifyCode(composer, { baseline: true });
    await capture(run.page, `code-${theme}-1280`);
    if (theme === 'light') {
      const crop = 'code-light-1280-composer.png';
      await composer.locator('.composer-surface').screenshot({ path: `${output}/${crop}` });
      results.screenshots.push(crop);
      await verifyPickerFocus(run.page, composer);
      await verifyWorktreeControl(composer);
      await verifyModeRetention(run.page);
      results.checks.push('project/branch/worktree/access/model Escape restores input focus; Worktree checkbox switches draft mode/base and restores current branch; retained Code and Chat textarea identity and independent unsent drafts');
    }
    results.scenes.push({ ...run.options, geometry });
    await run.context.close();
  }
  for (const options of [{ width: 1000, height: 800, lang: 'zh-CN', fontSize: 20 }, { dpr: 1.25 }, { state: 'split', width: 1000, height: 800, lang: 'zh-CN' }]) {
    const run = await open(options);
    const composers = run.page.locator('[data-composer-layout="desktop"]:visible');
    const geometry = [];
    for (const composer of await composers.all()) geometry.push(await verifyCode(composer, { draftControls: options.state !== 'split' }));
    const name = options.state === 'split' ? 'code-narrow-split-1000-zh-CN' : options.dpr ? 'code-dpr125-1280' : 'code-font20-1000-zh-CN';
    const pixels = await capture(run.page, name);
    if (options.dpr) near(pixels.width, 1280 * options.dpr, 0);
    results.scenes.push({ ...run.options, geometry, pixels });
    await run.context.close();
  }
  const chat = await open({ mode: 'chat' });
  const chatComposer = chat.page.locator('[data-composer-layout="desktop"]:visible');
  const chatGeometry = await measure(chatComposer);
  near(chatGeometry.dock.w, 640);
  expect(chatGeometry.shell.display).toBe('flex');
  expect(chatGeometry.field.h).toBeGreaterThanOrEqual(53);
  expect(chatGeometry.send.y).toBeLessThan(bottom(chatGeometry.shell));
  expect(chatGeometry.plus.y).toBeLessThan(bottom(chatGeometry.shell));
  expect(chatGeometry.documentOverflow).toBe(false);
  await hitTest(chatComposer.locator('.composer-plus'));
  await capture(chat.page, 'chat-light-1280');
  results.scenes.push({ ...chat.options, geometry: chatGeometry });
  await chat.context.close();

  // Mount the actual compact Composer in this isolated fixture document only.
  // The production phone shell is not started or modified by this test.
  const compact = await open({ width: 390, height: 844 });
  await compact.page.evaluate(async () => {
    const [react, reactDom, { Composer }] = await Promise.all([import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'), import('/src/features/sessions/ui/Composer.tsx')]);
    const createElement = react.createElement ?? react.default.createElement;
    const createRoot = reactDom.createRoot ?? reactDom.default.createRoot;
    document.getElementById('root').style.display = 'none';
    document.documentElement.removeAttribute('data-desktop-mode');
    document.documentElement.removeAttribute('data-skin');
    const host = document.createElement('div');
    host.style.cssText = 'width:100%;min-width:0;padding:8px;box-sizing:border-box';
    document.body.append(host);
    const noop = () => {};
    createRoot(host).render(createElement(Composer, { compact: true, focused: true, harness: 'claude', model: 'claude-sonnet', runtimeMode: 'full-access', cwd: '/fixture/monocode', executionCwd: '/fixture/monocode', sessionId: 'fixture-compact', remoteSession: true, hideBranchPicker: true, context: { used: 33000, window: 100000 }, onFocus: noop, onCwdChange: noop, onModelChange: noop, onRuntimeModeChange: noop, onSubmit: noop }));
  });
  const compactComposer = compact.page.locator('[data-composer-layout="compact"]');
  await compactComposer.locator('textarea').waitFor();
  await compact.page.waitForTimeout(300);
  const compactGeometry = await measure(compactComposer);
  expect(compactGeometry.shell.display).not.toBe('grid');
  expect(compactGeometry.field.w).toBeGreaterThan(200);
  expect(compactGeometry.documentOverflow).toBe(false);
  await compactComposer.locator('textarea').fill('Compact phone draft.');
  await expect(compactComposer.locator('textarea')).toHaveValue('Compact phone draft.');
  await capture(compact.page, 'compact-light-390');
  results.scenes.push({ mode: 'compact', width: 390, height: 844, geometry: compactGeometry });
  await compact.context.close();
  expect(results.errors).toEqual([]);
  results.checks.push('Code top workspace controls precede input; one footer row with plus/access/model/context; no plus hit-area overlap; context adjacent to model');
  results.checks.push('Code dock800 at1280; Chinese20px type; DPR1.25 physical screenshot; narrow split; Chat640 and isolated actual compact Composer');
  results.status = 'passed';
  console.log(JSON.stringify({ status: results.status, browser: results.browser, version: results.version, scenes: results.scenes.length, screenshots: results.screenshots.length, checks: results.checks, errors: results.errors }, null, 2));
} catch (error) {
  results.status = 'failed'; results.failure = String(error.stack || error);
  throw error;
} finally {
  await fs.writeFile(`${output}/verification.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
