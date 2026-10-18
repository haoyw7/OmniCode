// Run against `npx vite --host 127.0.0.1 --port 1436`.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1,timezoneId:'UTC'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
const base='http://127.0.0.1:1436/tests/browser/bots-rea.html';
const active=()=>page.locator('.desktop-bots-thread-surface:not([aria-hidden])');
const input=()=>active().locator('.assistant-compose textarea');
try {
await page.goto(base); await input().waitFor();
await expect(active().locator('.desktop-bots-navigation')).toHaveCSS('width','280px');
const resize=page.getByRole('separator',{name:'Resize sidebar'});
const rect=await resize.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+100);await page.mouse.down();await page.mouse.move(rect.x+180,rect.y+100,{steps:12});await page.mouse.up();
await expect(active().locator('.desktop-bots-navigation')).toHaveCSS('width','400px');
await resize.focus();await page.keyboard.press('Home');await expect(active().locator('.desktop-bots-navigation')).toHaveCSS('width','240px');await resize.dblclick();await expect(active().locator('.desktop-bots-navigation')).toHaveCSS('width','280px');checks.push('pointer clamp / keyboard bounds / double-click reset');
await input().fill('First line\nSecond line\n'+ 'long line\n'.repeat(12));await expect(active().locator('.assistant-compose')).toHaveAttribute('data-multiline','true');
await expect(input()).toHaveCSS('max-height','120px');
expect(await active().locator('.assistant-compose').evaluate(e=>e.getBoundingClientRect().height-e.querySelector('textarea').getBoundingClientRect().height)).toBe(60);await page.screenshot({path:'build/bots-rea/after-multiline.png'});
await input().fill('Draft survives panels');
const details=page.getByRole('button',{name:'Bot details',exact:true});
for(let i=0;i<7;i++) await details.click({delay:20});
await expect(active().locator('.desktop-bots-inspector')).not.toHaveAttribute('inert');
await page.getByRole('button',{name:'Runtime',exact:true}).click();await page.waitForTimeout(400);await page.screenshot({path:'build/bots-rea/after-runtime.png'});
await active().locator('.desktop-bot-details-heading button').click();await page.waitForTimeout(400);
await active().locator('.desktop-bots-inspector').press('Escape');await expect(details).toBeFocused();await expect(input()).toHaveValue('Draft survives panels');checks.push('rapid reversals / settings subpage and back / Escape focus restoration / draft retention');
await input().fill('');await active().getByRole('button',{name:'New bot',exact:true}).click();
await page.getByRole('combobox',{name:'Search or create a Bot'}).fill('Project assistant 2');await page.screenshot({path:'build/bots-rea/after-recipient.png'});await page.keyboard.press('Escape');await input().waitFor();checks.push('recipient search / cancel');
await active().locator('.desktop-bots-contact-main').first().click({button:'right'});await page.getByRole('menu').waitFor();await page.screenshot({path:'build/bots-rea/after-menu.png'});await page.keyboard.press('Escape');checks.push('context menu / Escape');
await active().getByRole('button',{name:'Project assistant 1',exact:true}).click();await input().waitFor();await page.screenshot({path:'build/bots-rea/after-empty.png'});checks.push('empty conversation');
await active().getByRole('button',{name:'MonoCode',exact:true}).click();await input().waitFor();
for (const width of [680,540]) {await page.setViewportSize({width,height:800});await page.waitForTimeout(450);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`build/bots-rea/after-${width}.png`});}checks.push('680px / 540px no document overflow');
await page.emulateMedia({reducedMotion:'reduce'});await details.click();await page.waitForTimeout(50);await page.getByRole('button',{name:'Hide bot details'}).click();await expect(active().locator('.desktop-bots-inspector')).toHaveAttribute('data-fold-state','closed');checks.push('reduced motion closes inspector');
await page.setViewportSize({width:1280,height:800});await page.goto(base+'?modal');await page.getByRole('dialog').waitFor();await page.screenshot({path:'build/bots-rea/after-dialog.png'});await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);checks.push('memory dialog / error text / cancel');
await page.goto(base+'?error');await input().waitFor();await input().fill('Synthetic message');await input().press('Enter');await expect(page.getByText('Synthetic offline delivery failure',{exact:false}).first()).toBeVisible();await page.screenshot({path:'build/bots-rea/after-error.png'});checks.push('send error / retry notice');
expect(errors).toEqual([]);
console.log(JSON.stringify({checks,errors}));await fs.writeFile('build/bots-rea/scenarios.json',JSON.stringify({checks,errors},null,2));
} finally {await browser.close();}
