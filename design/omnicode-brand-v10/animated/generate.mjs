import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../svg');
const readySource = await fs.readFile(path.join(staticDir, 'omi-ready.svg'), 'utf8');
const doneSource = await fs.readFile(path.join(staticDir, 'omi-done.svg'), 'utf8');
const paths = source => [...source.matchAll(/<path\b[^>]*\/>/g)].map(match => match[0]);
const [outline, face] = paths(readySource);
const [, happyFace, check] = paths(doneSource);
if (!outline || !face || !happyFace || !check) throw new Error('Static master paths missing');

const ease = 'cubic-bezier(.22,1,.36,1)';
const states = [
  { id:'ready', label:'待命', duration:2.88, copy:'轻浮动与眨眼', keys:`
@keyframes omi-ready-body { 0%,66.666%,100% {transform:translateY(0)} 8.333%,58.333% {transform:translateY(-3px)} }
@keyframes omi-ready-face { 0%,72%,84%,100% {transform:scaleY(1)} 78% {transform:scaleY(.16)} }`, rules:'.omi-body{animation:omi-ready-body 2.88s EASE infinite}.omi-face{animation:omi-ready-face 2.88s EASE infinite;transform-origin:128px 127px}', extra:'' },
  { id:'thinking', label:'思考', duration:2.4, copy:'视线微移，思考点交替', keys:`
@keyframes omi-thinking-face { 0%,20%,70%,100% {transform:translate(0,0)} 30%,60% {transform:translate(4px,-5px)} }
@keyframes omi-thinking-dot { 0%,66.666%,100% {opacity:.25} 33.333% {opacity:1} }`, rules:'.omi-face{animation:omi-thinking-face 2.4s EASE infinite}.omi-dot{animation:omi-thinking-dot .72s EASE infinite}.omi-dot-b{animation-delay:-.24s}.omi-dot-c{animation-delay:-.48s}', extra:'<g stroke="none"><circle class="omi-a omi-dot" cx="222" cy="23" r="5"/><circle class="omi-a omi-dot omi-dot-b" cx="241" cy="23" r="5"/><circle class="omi-a omi-dot omi-dot-c" cx="260" cy="23" r="5"/></g>' },
  { id:'running', label:'执行', duration:1.2, copy:'不定进度线，无虚假百分比', keys:`
@keyframes omi-running-line { 0% {opacity:0;transform:translateX(0)} 20% {opacity:1;transform:translateX(0)} 80% {opacity:1;transform:translateX(120px)} 100% {opacity:0;transform:translateX(120px)} }`, rules:'.omi-progress{animation:omi-running-line 1.2s EASE infinite}', extra:'<path d="M 76 291 H 244" fill="none" stroke-width="9" opacity=".2" stroke-linecap="round"/><path class="omi-a omi-progress" d="M 76 291 H 124" fill="none" stroke-width="9" stroke-linecap="round"/>' },
  { id:'done', label:'完成', duration:2.4, copy:'轻点头，勾线绘制后停留', keys:`
@keyframes omi-done-body { 0%,20%,100% {transform:translateY(0)} 10% {transform:translateY(-5px)} }
@keyframes omi-done-check { 0% {opacity:0;stroke-dashoffset:1} 10%,90% {opacity:1;stroke-dashoffset:0} 100% {opacity:0;stroke-dashoffset:0} }
@keyframes omi-done-check-once { from {opacity:0;stroke-dashoffset:1} to {opacity:1;stroke-dashoffset:0} }`, rules:'.omi-body{animation:omi-done-body 2.4s EASE infinite}.omi-check{stroke-dasharray:1;stroke-dashoffset:0;animation:omi-done-check 2.4s EASE infinite}.omi-once .omi-body{animation:omi-done-body 2.4s EASE 1 both}.omi-once .omi-check{animation:omi-done-check-once .24s EASE 1 both}', extra:check.replace('<path ', '<path class="omi-a omi-check" pathLength="1" ') },
  { id:'approval', label:'等待确认', duration:2.4, copy:'提示气泡轻微明暗变化', keys:`
@keyframes omi-approval-bubble { 0%,70%,100% {opacity:.45} 10%,60% {opacity:1} }`, rules:'.omi-bubble{animation:omi-approval-bubble 2.4s EASE infinite}', extra:'<g class="omi-a omi-bubble"><path d="M 237 12 H 285 Q 294 12 294 21 V 40 Q 294 49 285 49 H 263 L 251 60 V 49 H 237 Q 228 49 228 40 V 21 Q 228 12 237 12 Z" fill="none" stroke-width="4"/><g stroke="none"><circle cx="244" cy="31" r="3.5"/><circle cx="261" cy="31" r="3.5"/><circle cx="278" cy="31" r="3.5"/></g></g>' },
  { id:'connecting', label:'连接中', duration:.96, copy:'两点交替，不旋转标志', keys:`
@keyframes omi-connecting-dot { 0%,100% {opacity:.25} 25%,50% {opacity:1} 75% {opacity:.25} }`, rules:'.omi-dot{animation:omi-connecting-dot .96s EASE infinite}.omi-dot-b{animation-delay:-.48s}', extra:'<g stroke="none"><circle class="omi-a omi-dot" cx="265" cy="22" r="5"/><circle class="omi-a omi-dot omi-dot-b" cx="287" cy="44" r="5"/></g>' },
];

function make(state, color, once=false) {
  const root = `.omi-motion-${state.id}`;
  // Scope every selector so different SVG states can be inlined together.
  const rules = state.rules.replaceAll('EASE',ease).replace(/([^{}]+)\{/g, (_, selector) => {
    if (selector.startsWith('.omi-once ')) return `${root}.omi-once ${selector.slice(10)}{`;
    return `${root} ${selector}{`;
  });
  const style = `${state.keys}\n${rules}
${root} .omi-a {transform-box:view-box}
${root}[data-paused="true"] .omi-a {animation-play-state:paused}
${root}[data-motion="off"] .omi-a {animation:none!important}
@media (prefers-reduced-motion:reduce) {${root} .omi-a {animation:none!important}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" class="omi-motion omi-motion-${state.id}${once?' omi-once':''}" role="img" aria-label="Omi · ${state.label}" data-state="${state.id}" data-duration="${state.duration}">
  <style>${style}</style>
  <g fill="${color}" stroke="${color}"><g transform="translate(32 32)"><g class="omi-a omi-body">${outline}<g class="omi-a omi-face">${state.id==='done'?happyFace:face}</g></g></g>${state.extra}</g>
</svg>\n`;
}

await fs.mkdir(path.join(here,'static'),{recursive:true});
for (const state of states) {
  const staticSource=await fs.readFile(path.join(staticDir,`omi-${state.id}.svg`),'utf8');
  for (const [variant,color] of [['black','#151515'],['white','#ffffff'],['current','currentColor']]) {
    await fs.writeFile(path.join(here,`omi-${state.id}-${variant}.svg`), make(state,color));
    await fs.writeFile(path.join(here,'static',`omi-${state.id}-${variant}.svg`),staticSource.replaceAll('currentColor',color));
    if(state.id==='done') await fs.writeFile(path.join(here,`omi-done-once-${variant}.svg`),make(state,color,true));
  }
}

const wordmark=await fs.readFile(path.join(staticDir,'omnicode-horizontal-current.svg'),'utf8');
const cards=states.map(s=>`<article class="card"><div class="art">${make(s,'currentColor')}</div><div class="card-title"><h2>${s.label}</h2><span>${s.duration}s 循环</span></div><p>${s.copy}</p></article>`).join('');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OmniCode · 透明短动画</title><style>
@font-face{font-family:Source;src:url('../../../public/fonts/source-sans/SourceSans3VF-Upright.ttf.woff2')}*{box-sizing:border-box}body{margin:0;background:#f1f1f1;color:#151515;font:16px Source,system-ui,sans-serif;padding:32px}main{max-width:1080px;margin:auto}.brand{width:260px;max-width:80vw}.brand svg{width:100%;height:auto}h1{font-size:26px;margin:22px 0 10px}.intro{color:#555;line-height:1.6}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:24px 0}button,label{font:inherit}button{border:1px solid #bbb;padding:8px 16px;border-radius:8px;background:#fff;color:#151515;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #777;outline-offset:3px}label{display:flex;gap:7px;align-items:center;padding:8px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card,.once{background:#fff;border:1px solid #e2e2e2;border-radius:16px;padding:24px}.art{display:flex;align-items:center;justify-content:center;height:210px}.art svg{width:210px;height:210px}.card-title{display:flex;align-items:baseline;justify-content:space-between;gap:12px}h2{font-size:18px;margin:14px 0 8px}.card p,.card-title span{font-size:13px;opacity:.65;margin:0;line-height:1.5}.once{margin-top:18px;display:flex;gap:24px;align-items:center}.once .omi-motion{width:120px;height:120px;flex-shrink:0}.once h2{margin:0 0 6px}.once p{margin:0 0 14px;font-size:14px;opacity:.7}.note{font-size:13px;line-height:1.7;color:#666;margin-top:20px}.dark{background:#101010;color:#fff}.dark .card,.dark .once{background:#1b1b1b;border-color:#333}.dark .intro,.dark .note{color:#bbb}.checker .art{background:repeating-conic-gradient(#b0b0b030 0% 25%,transparent 0% 50%) 0/16px 16px;border-radius:8px}@media(max-width:780px){body{padding:20px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.art{height:170px}.art svg{width:170px;height:170px}}@media(max-width:480px){.grid{grid-template-columns:1fr}.once{gap:12px;padding:16px}}
</style><main><div class="brand">${wordmark}</div><h1>透明短动画</h1><p class="intro">同一个轮廓，六种轻量表达。SVG 自带动画，无需脚本或动画库。</p><div class="controls"><button id="pause" aria-pressed="false">暂停</button><button id="restart">从头播放</button><button id="theme" aria-pressed="false">深色背景</button><label><input type="checkbox" id="reduce">静态预览</label><label><input type="checkbox" id="checker">透明网格</label></div><section class="grid">${cards}</section><section class="once"><div id="done-once">${make(states.find(s=>s.id==='done'),'currentColor',true)}</div><div><h2>完成 · 单次播放</h2><p>勾线绘制后保持完成状态，用于真实任务结束。</p><button id="replay-done">重新播放完成动画</button></div></section><p class="note">动画素材本身没有背景。系统启用“减少动态效果”时自动显示静态状态。固定品牌图标建议使用原静态版本。进度线仅表示正在处理，不代表完成百分比。</p></main><script>
const all=()=>[...document.querySelectorAll('.omi-motion')];
let paused=false;
document.querySelector('#pause').onclick=e=>{paused=!paused;all().forEach(el=>el.dataset.paused=String(paused));e.currentTarget.textContent=paused?'继续':'暂停';e.currentTarget.setAttribute('aria-pressed',String(paused))};
document.querySelector('#restart').onclick=()=>{document.getAnimations().forEach(a=>a.currentTime=0)};
document.querySelector('#theme').onclick=e=>{const dark=document.body.classList.toggle('dark');e.currentTarget.textContent=dark?'浅色背景':'深色背景';e.currentTarget.setAttribute('aria-pressed',String(dark))};
document.querySelector('#reduce').onchange=e=>all().forEach(el=>el.dataset.motion=e.target.checked?'off':'on');
document.querySelector('#checker').onchange=e=>document.body.classList.toggle('checker',e.target.checked);
document.querySelector('#replay-done').onclick=()=>document.querySelector('#done-once').getAnimations({subtree:true}).forEach(a=>{a.currentTime=0;if(!paused)a.play()});
document.addEventListener('visibilitychange',()=>all().forEach(el=>el.dataset.paused=String(paused||document.hidden)));
</script></html>`;
await fs.writeFile(path.join(here,'preview.html'),html);
const externalExamples=states.map(s=>`<article><picture><source media="(prefers-reduced-motion: reduce)" srcset="static/omi-${s.id}-black.svg"><img src="omi-${s.id}-black.svg" width="180" height="180" alt="Omi · ${s.label}"></picture><p>${s.label}</p></article>`).join('');
await fs.writeFile(path.join(here,'embedding.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OmniCode · 外部图片嵌入</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;font:16px system-ui,sans-serif;color:#151515;background:white}h1{font-size:26px}.grid{display:flex;flex-wrap:wrap;gap:24px}article{text-align:center}pre{padding:20px;background:#f5f5f5;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:10px}label{display:block;margin:24px 0}p{line-height:1.7}</style><h1>外部 SVG 图片嵌入</h1><p>通过 picture 在宿主页面匹配系统偏好，启用减少动态效果后选择 static/ 下的静态 SVG。外部图片中的 CSS 媒体查询不能作为唯一保障。</p><label><input id="static" type="checkbox">手动切换静态版本</label><div class="grid">${externalExamples}</div><pre>&lt;picture&gt;
  &lt;source media="(prefers-reduced-motion: reduce)"
          srcset="static/omi-thinking-black.svg"&gt;
  &lt;img src="omi-thinking-black.svg" width="80" height="80"
       alt="Omi · 思考"&gt;
&lt;/picture&gt;</pre><script>document.querySelector('#static').onchange=e=>document.querySelectorAll('source').forEach(source=>source.media=e.target.checked?'all':'(prefers-reduced-motion: reduce)');</script></html>`);
console.log('Generated 21 animated SVGs, 18 static fallbacks and two HTML previews');
