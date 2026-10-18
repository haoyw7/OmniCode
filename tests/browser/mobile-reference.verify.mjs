import { chromium, webkit, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const engine = process.env.MOBILE_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch(engine === chromium ? { executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] } : {headless:true});
const page = await browser.newPage({ viewport: {width:390,height:844}, isMobile:true, hasTouch:true });
const errors=[];page.on('pageerror',e=>errors.push({message:e.message,url:page.url()}));
const output=`build/mobile-reference/${engine.name()}`;await fs.mkdir(output,{recursive:true});
const base=process.env.VISUAL_BASE_URL || 'http://127.0.0.1:1441';
const result={browser:engine.name(),version:browser.version(),screenshots:[],checks:[],geometry:[],errors};
async function open(file,query=''){await page.goto(`${base}/tests/browser/${file}.html?${query}`);await page.locator('.mobile-app').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);}
async function capture(name){const path=`${output}/${name}.png`;await page.screenshot({path});result.screenshots.push(path);}
async function size(selector){return page.locator(selector).first().evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,radius:s.borderRadius,font:s.fontSize,line:s.lineHeight};});}
try{
 for(const dark of [false,true]){
  await open('mobile-controls',dark?'dark':'');
  await expect(page.getByRole('button',{name:'继续',exact:true})).toHaveCSS('min-height','44px');
  await expect(page.getByRole('button',{name:'小按钮',exact:true})).toHaveCSS('min-height','32px');
  const toggle=page.getByRole('switch',{name:'通知',exact:true});
  await expect(toggle).toHaveCSS('width','64px');await expect(toggle).toHaveCSS('height','28px');
  const thumb=toggle.locator('[data-slot="switch-thumb"]');await expect(thumb).toHaveCSS('width','39px');
  const off=await thumb.boundingBox();await toggle.click();await expect(toggle).toBeChecked();
  await expect.poll(async()=>Math.round((await thumb.boundingBox()).x-off.x)).toBe(21);
  await page.emulateMedia({reducedMotion:'reduce'});await toggle.click();await expect(toggle).not.toBeChecked();await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(page.getByRole('switch',{name:'已开启',exact:true})).toBeDisabled();
  await expect(page.getByRole('textbox',{name:'名称',exact:true})).toHaveCSS('min-height','44px');
  await page.getByRole('textbox',{name:'名称',exact:true}).fill('Monocode');
  await page.getByRole('button',{name:'选择模型',exact:true}).click();await page.getByRole('radio',{name:'选项二',exact:true}).check();
  await expect(page.getByRole('button',{name:'选择模型',exact:true})).toContainText('选项二');
  await expect(page.locator('.mobile-sheet')).toHaveCount(0);
  const card=await size('.mobile-composer-input');result.geometry.push({theme:dark?'dark':'light',composer:card});
  expect(Math.round(card.height)).toBe(100);expect(card.radius).toBe('24px');
  await capture(`controls-${dark?'dark':'light'}`);
 }
 for(const state of ['running','stopping']){await open('mobile-controls',state);const stop=page.getByRole('button',{name:'停止',exact:true});await expect(stop).toHaveAttribute('data-state',state==='running'?'streaming':'stopping');if(state==='stopping')await expect(stop).toBeDisabled();await capture(state);}
 for(const theme of ['light','dark'])for(const width of [320,390,430]){
  await page.setViewportSize({width,height:844});await open('mobile-messaging',`theme=${theme}&long`);
  await expect(page.locator('.mobile-header')).toHaveCSS('height','54px');
  const field=page.getByRole('textbox',{name:'消息',exact:true});
  await field.fill('保留这段草稿');
  const saved=await field.inputValue();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  const drawer=page.locator('.mobile-drawer');await expect(drawer).toBeVisible();
  await expect.poll(async()=>Math.abs((await drawer.boundingBox()).x)).toBeLessThan(.5);
  expect((await drawer.boundingBox()).width).toBeLessThanOrEqual(Math.min(340,width*.85)+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await capture(`drawer-${theme}-${width}`);
  await page.keyboard.press('Escape');await expect(drawer).toBeHidden();await expect(field).toHaveValue(saved);
  await capture(`conversation-${theme}-${width}`);
  await open('mobile-messaging',`theme=${theme}&empty`);await expect(page.locator('.mobile-empty h2')).toHaveCSS('font-size','28px');await capture(`new-chat-${theme}-${width}`);
 }
 await page.setViewportSize({width:844,height:390});await open('mobile-messaging','theme=light&long');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture('landscape');
 await page.setViewportSize({width:390,height:844});await open('mobile-messaging','theme=light');await page.evaluate(()=>{document.documentElement.style.setProperty('--safe-area-inset-top','47px');document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');});expect((await page.locator('.mobile-header').boundingBox()).y).toBeGreaterThanOrEqual(47);await capture('safe-areas');
 expect(errors).toEqual([]);result.checks.push('shared controls dimensions, state, disabled and reduced motion','native radio choice in mobile sheet','composer 100px/24px and stopping state','new chat/conversation/drawer at 320/390/430px in both themes','drawer close retains draft','landscape and simulated safe areas','no document overflow or page errors');
 await fs.writeFile(`${output}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
