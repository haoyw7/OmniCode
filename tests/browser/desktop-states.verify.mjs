// Focused approval/question checks after fixing the fixture's shared question contract.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const output = 'build/desktop-state-visual';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 932 }, deviceScaleFactor: 1, timezoneId: 'UTC' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const result = { browser: 'chromium', version: browser.version(), dpr: 1, rpc: 'simulated; real QuestionForm and transcript approval controls', screenshots: [], checks: [], interactions: {}, errors };
const fixture = `${process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1436'}/tests/browser/desktop-visual.html`;
async function capture(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  result.screenshots.push(file);
}
try {
  for (const theme of ['light', 'dark']) {
    await page.goto(`${fixture}?page=workspace&mode=code&state=question&theme=${theme}`);
    const question = page.locator('[data-question-form]:visible');
    await expect(question).toContainText('Which workspace should we refine first?');
    await expect(question.locator('[data-question-dock-option]')).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const submit = question.getByRole('button', { name: 'Send', exact: true });
    await expect(submit).toBeDisabled();
    const choice = question.locator('[data-question-dock-option]').filter({ hasText: 'Conversation' });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(submit).toBeEnabled();
    await capture(`code-question-${theme}-1280`);
    await submit.click();
    await expect(question).toHaveCount(0);
    await expect(page.locator('.composer-field:visible')).toBeFocused();
    const reply = await page.evaluate(() => window.desktopFixture.interactions);
    expect(reply).toEqual([{ kind: 'question', sessionId: 'fixture-code', requestId: 7, value: { kind: 'answered', answers: { workspace: ['conversation'] } } }]);
    result.interactions[`question-${theme}`] = reply;
    result.checks.push(`${theme}: real prompt/option IDs render, selection enables Send, callback receives workspace/conversation answer and composer regains focus`);

    await page.goto(`${fixture}?page=workspace&mode=code&state=approval&theme=${theme}`);
    const allow = page.locator('[data-approval="allow"]:visible');
    const deny = page.locator('[data-approval="deny"]:visible');
    await expect(allow).toBeEnabled();
    await expect(deny).toBeEnabled();
    await expect(page.locator('.agent-transcript:visible')).toContainText('npm test -- --run src/features/workspace/ui/PaneTreeSurfaces.test.ts');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await capture(`code-approval-${theme}-1280`);
    await allow.click();
    await expect(allow).toHaveCount(0);
    await page.evaluate(() => window.desktopFixture.setState('approval'));
    await expect(deny).toBeEnabled();
    await deny.click();
    await expect(deny).toHaveCount(0);
    const approvals = await page.evaluate(() => window.desktopFixture.interactions);
    expect(approvals).toEqual([{ kind: 'approval', sessionId: 'fixture-code', requestId: 9, value: 'allow' }, { kind: 'approval', sessionId: 'fixture-code', requestId: 9, value: 'deny' }]);
    result.interactions[`approval-${theme}`] = approvals;
    result.checks.push(`${theme}: pending shell approval shows command and both controls; Allow/Deny callbacks receive exact request9 and resolve the real controls without executing a command`);

    await page.goto(`${fixture}?page=workspace&mode=code&state=empty&theme=${theme}`);
    const composer = page.locator('.composer-field:visible');
    await composer.fill('Synthetic composition guard and local submit');
    await composer.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true })));
    await expect(composer).toHaveValue('Synthetic composition guard and local submit');
    expect(await page.evaluate(() => window.desktopFixture.interactions)).toEqual([]);
    expect(await page.evaluate(() => window.desktopFixture.getSession().busy)).toBeFalsy();
    await composer.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'submit' })));
    await composer.press('Enter');
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeVisible();
    await expect(composer).toHaveValue('');
    await expect(page.locator('.agent-transcript:visible')).toContainText('Synthetic composition guard and local submit');
    expect(await page.evaluate(() => window.desktopFixture.getSession().busy)).toBe(true);
    await stop.click();
    await expect(stop).toHaveCount(0);
    expect(await page.evaluate(() => window.desktopFixture.getSession().busy)).toBe(false);
    const submitFlow = await page.evaluate(() => window.desktopFixture.interactions);
    expect(submitFlow).toEqual([{ kind: 'submit', sessionId: 'fixture-code', value: { text: 'Synthetic composition guard and local submit', attachments: [] } }, { kind: 'stop', sessionId: 'fixture-code', value: 'idle' }]);
    result.interactions[`submit-stop-${theme}`] = submitFlow;
    result.checks.push(`${theme}: synthetic isComposing Enter leaves draft unsent; after compositionend normal Enter routes through real Composer/SessionPane submit to busy Stop, and clicking Stop returns fixture session to idle; no native IME or provider execution claimed`);
  }
  expect(errors).toEqual([]);
  await fs.writeFile(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ version: result.version, screenshots: result.screenshots.length, checks: result.checks.length, errors }, null, 2));
} finally {
  await browser.close();
}
