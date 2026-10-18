import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const masters=path.resolve(here,'../svg');
const ready=await fs.readFile(path.join(masters,'omi-ready.svg'),'utf8');
const outline=ready.match(/<path\b[^>]*\/>/)?.[0];
if(!outline)throw new Error('Original Omi contour not found');
const line=(d,w=17)=>`<path d="${d}" fill="none" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const dot=(x,y,r=5)=>`<circle cx="${x}" cy="${y}" r="${r}" stroke="none"/>`;
const ring=(x,y,r=10,w=8)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke-width="${w}"/>`;
const ease='cubic-bezier(.22,1,.36,1)';

const expressions=[
  {
    id:'curious',label:'疑惑',duration:2.4,copy:'挑起一边眉毛，轻轻歪头',
    face:dot(92,126,9)+line('M 151 130 L 177 123',17)+line('M 78 98 Q 91 89 105 96',7),
    extra:`<g class="omx-a omx-accent">${line('M 261 30 Q 261 17 274 17 Q 288 17 288 29 Q 288 37 277 42 V 48',5)}${dot(277,61,3.5)}</g>`,
    rules:[['body','animation:BODY 2.4s EASE infinite;transform-origin:128px 128px'],['accent','animation:ACCENT 2.4s EASE infinite']],
    keys:{body:'0%,60%,100%{transform:rotate(0deg)}10%,50%{transform:rotate(-4deg)}',accent:'0%,60%,100%{opacity:.4;transform:translateY(3px)}10%,50%{opacity:1;transform:translateY(0)}'},
  },
  {
    id:'inspired',label:'灵感',duration:2.4,copy:'视线向上，三条灵感线展开',
    face:line('M 80 137 L 94 117 L 108 137 M 149 137 L 163 117 L 177 137',16),
    extra:`<g class="omx-a omx-accent">${line('M 156 29 V 13 M 133 34 L 122 24 M 179 34 L 190 24',6)}</g>`,
    rules:[['body','animation:BODY 2.4s EASE infinite'],['accent','animation:ACCENT 2.4s EASE infinite;transform-origin:156px 34px']],
    keys:{body:'0%,30%,100%{transform:translateY(0)}10%,20%{transform:translateY(-4px)}',accent:'0%,80%,100%{opacity:.3;transform:scale(.8)}10%,70%{opacity:1;transform:scale(1)}'},
  },
  {
    id:'focused',label:'专注',duration:2.4,copy:'收紧眼神，小幅左右观察',
    face:line('M 79 116 L 106 127 L 79 138 M 156 120 V 134',16)+line('M 78 96 L 106 102 M 148 102 L 176 96',6),
    extra:'',
    rules:[['face','animation:FACE 2.4s EASE infinite']],
    keys:{face:'0%,30%,60%,100%{transform:translateX(0)}10%,20%{transform:translateX(5px)}40%,50%{transform:translateX(-5px)}'},
  },
  {
    id:'surprised',label:'惊讶',duration:2.4,copy:'睁圆眼睛，轻轻向上弹起',
    face:ring(91,122,11,8)+ring(165,122,11,8)+ring(128,168,7,6),
    extra:`<g class="omx-a omx-accent">${line('M 279 21 V 40',6)}${dot(279,53,3.5)}</g>`,
    rules:[['body','animation:BODY 2.4s EASE infinite'],['face','animation:FACE 2.4s EASE infinite;transform-origin:128px 130px'],['accent','animation:ACCENT 2.4s EASE infinite']],
    keys:{body:'0%,20%,100%{transform:translateY(0)}10%{transform:translateY(-7px)}',face:'0%,20%,100%{transform:scale(1)}10%{transform:scale(1.06)}',accent:'0%,80%,100%{opacity:.35}10%,70%{opacity:1}'},
  },
  {
    id:'sleepy',label:'困倦',duration:3.6,copy:'闭眼慢呼吸，睡眠符号缓缓上浮',
    face:line('M 78 120 Q 92 138 106 120 M 150 120 Q 164 138 178 120',15),
    extra:`<g class="omx-a omx-accent">${line('M 258 28 H 278 L 258 48 H 278',4)}</g>`,
    rules:[['body','animation:BODY 3.6s EASE infinite'],['accent','animation:ACCENT 3.6s EASE infinite']],
    keys:{body:'0%,66.666%,100%{transform:translateY(0)}6.666%,60%{transform:translateY(3px)}',accent:'0%{opacity:0;transform:translate(0,6px)}6.666%{opacity:1;transform:translate(0,6px)}60%{opacity:1;transform:translate(4px,-6px)}66.666%,100%{opacity:0;transform:translate(4px,-6px)}'},
  },
  {
    id:'joyful',label:'开心',duration:2.4,copy:'眯眼笑，连续两次轻跳',
    face:line('M 103 111 L 83 126 L 103 141 M 153 111 L 173 126 L 153 141',14)+line('M 111 164 Q 128 179 145 164',8),
    extra:`<g class="omx-a omx-accent">${line('M 278 245 L 288 237 M 285 259 H 298',5)}</g>`,
    rules:[['body','animation:BODY 2.4s EASE infinite'],['accent','animation:ACCENT 2.4s EASE infinite']],
    keys:{body:'0%,20%,40%,100%{transform:translateY(0)}10%{transform:translateY(-6px)}30%{transform:translateY(-3px)}',accent:'0%,40%,100%{opacity:.3}10%,30%{opacity:1}'},
  },
  {
    id:'encouraging',label:'鼓励',duration:2.4,copy:'眨眼点头，小爱心轻轻上浮',
    face:line('M 83 111 L 106 127 L 83 143',17)+`<g class="omx-a omx-wink">${line('M 149 130 Q 163 112 177 130',15)}</g>`,
    extra:'<g class="omx-a omx-accent"><path d="M 280 256 C 267 245 259 253 263 262 C 266 269 280 278 280 278 C 280 278 294 269 297 262 C 301 253 293 245 280 256 Z" stroke="none"/></g>',
    rules:[['body','animation:BODY 2.4s EASE infinite;transform-origin:128px 128px'],['accent','animation:ACCENT 2.4s EASE infinite'],['wink','animation:WINK 2.4s EASE infinite;transform-origin:163px 127px']],
    keys:{body:'0%,20%,100%{transform:rotate(0deg)}10%{transform:rotate(3deg)}',accent:'0%,30%,100%{transform:translateY(0);opacity:.55}10%,20%{transform:translateY(-5px);opacity:1}',wink:'0%,20%,100%{transform:scaleY(1)}10%{transform:scaleY(.2)}'},
  },
  {
    id:'error',label:'出错',duration:2.4,copy:'叉眼轻摇头，再短暂停留',
    face:line('M 81 115 L 103 137 M 103 115 L 81 137 M 153 115 L 175 137 M 175 115 L 153 137',11)+line('M 113 171 Q 128 158 143 171',7),
    extra:'',
    rules:[['body','animation:BODY 2.4s EASE infinite']],
    keys:{body:'0%,30%,100%{transform:translateX(0)}10%{transform:translateX(-4px)}20%{transform:translateX(4px)}'},
  },
];

function make(item,color,animated=true){
  const root=`.omi-expr-${item.id}`;
  const token=(s)=>s.replaceAll('EASE',ease).replace(/\b(BODY|FACE|ACCENT|WINK)\b/g,m=>`omi-expr-${item.id}-${m.toLowerCase()}`);
  const css=Object.entries(item.keys).map(([name,frames])=>`@keyframes omi-expr-${item.id}-${name}{${frames}}`).join('\n')+'\n'+item.rules.map(([part,rules])=>`${root} .omx-${part}{${token(rules)}}`).join('\n')+`
${root} .omx-a{transform-box:view-box}
${root}[data-paused="true"] .omx-a{animation-play-state:paused}
${root}[data-motion="off"] .omx-a{animation:none!important}
@media(prefers-reduced-motion:reduce){${root} .omx-a{animation:none!important}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" class="omi-expression omi-expr-${item.id}" role="img" aria-label="Omi · ${item.label}" data-state="${item.id}" data-duration="${item.duration}">
${animated?`<style>${css}</style>`:''}
<g fill="${color}" stroke="${color}"><g transform="translate(32 32)"><g class="omx-a omx-body">${outline}<g class="omx-a omx-face">${item.face}</g></g></g>${item.extra}</g>
</svg>\n`;
}

await fs.mkdir(path.join(here,'static'),{recursive:true});
for(const expression of expressions){
  for(const [variant,color] of [['black','#151515'],['white','#ffffff'],['current','currentColor']]){
    const filename=`omi-${expression.id}-${variant}.svg`;
    await fs.writeFile(path.join(here,filename),make(expression,color));
    await fs.writeFile(path.join(here,'static',filename),make(expression,color,false));
  }
}
await fs.writeFile(path.join(here,'manifest.json'),JSON.stringify(expressions.map(({id,label,duration,copy})=>({id,label,duration,description:copy})),null,2));
const brand=await fs.readFile(path.join(masters,'omnicode-horizontal-current.svg'),'utf8');
const cards=expressions.map(e=>`<article class="card"><div class="art">${make(e,'currentColor')}</div><header><h2>${e.label}</h2><span>${e.duration}s</span></header><p>${e.copy}</p></article>`).join('');
const preview=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Omi · 八种新表情</title><style>
@font-face{font-family:Source;src:url('../../../public/fonts/source-sans/SourceSans3VF-Upright.ttf.woff2')}*{box-sizing:border-box}body{margin:0;padding:32px;background:#f2f2f2;color:#151515;font:16px Source,system-ui,sans-serif}main{max-width:1240px;margin:auto}.brand{width:250px}.brand svg{width:100%;height:auto}h1{font-size:26px;margin:24px 0 8px}.intro,.note{color:#606060;line-height:1.7}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:24px 0}button,label{font:inherit}button{border:1px solid #bbb;padding:8px 14px;border-radius:8px;background:white;color:#151515;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #777;outline-offset:3px}label{display:flex;align-items:center;gap:6px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{border:1px solid #e2e2e2;background:white;border-radius:16px;padding:22px}.art{display:flex;justify-content:center;align-items:center;height:200px}.art svg{width:200px;height:200px}header{display:flex;justify-content:space-between;align-items:baseline;gap:10px}h2{font-size:18px;margin:15px 0 8px}header span,.card p{font-size:13px;opacity:.65}.card p{line-height:1.6;margin:0;min-height:42px}.note{font-size:13px;margin-top:24px}.dark{background:#101010;color:white}.dark .card{background:#1c1c1c;border-color:#333}.dark .intro,.dark .note{color:#bbb}.checker .art{border-radius:8px;background:repeating-conic-gradient(#aaa3 0% 25%,transparent 0% 50%) 0/16px 16px}@media(max-width:1040px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){body{padding:20px}.grid{grid-template-columns:1fr}}
</style><main><div class="brand">${brand}</div><h1>八种新表情</h1><p class="intro">疑惑 · 灵感 · 专注 · 惊讶 · 困倦 · 开心 · 鼓励 · 出错<br>透明矢量，沿用统一 O 形轮廓。</p><div class="controls"><button id="pause" aria-pressed="false">暂停</button><button id="restart">从头播放</button><button id="theme" aria-pressed="false">深色背景</button><label><input type="checkbox" id="reduce">静态预览</label><label><input type="checkbox" id="checker">透明网格</label></div><section class="grid">${cards}</section><p class="note">SVG 素材没有背景。表情变化只用于助手插画；正式品牌标志维持默认代码表情。系统启用减少动态效果时，内联 SVG 自动显示静态姿态。</p></main><script>
const all=()=>[...document.querySelectorAll('.omi-expression')];let paused=false;
document.querySelector('#pause').onclick=e=>{paused=!paused;all().forEach(el=>el.dataset.paused=String(paused));e.currentTarget.textContent=paused?'继续':'暂停';e.currentTarget.setAttribute('aria-pressed',String(paused))};
document.querySelector('#restart').onclick=()=>document.getAnimations().forEach(a=>a.currentTime=0);
document.querySelector('#theme').onclick=e=>{const dark=document.body.classList.toggle('dark');e.currentTarget.textContent=dark?'浅色背景':'深色背景';e.currentTarget.setAttribute('aria-pressed',String(dark))};
document.querySelector('#reduce').onchange=e=>all().forEach(el=>el.dataset.motion=e.target.checked?'off':'on');
document.querySelector('#checker').onchange=e=>document.body.classList.toggle('checker',e.target.checked);
document.addEventListener('visibilitychange',()=>all().forEach(el=>el.dataset.paused=String(paused||document.hidden)));
</script></html>`;
await fs.writeFile(path.join(here,'preview.html'),preview);
const images=expressions.map(e=>`<article><picture><source media="(prefers-reduced-motion: reduce)" srcset="static/omi-${e.id}-black.svg"><img src="omi-${e.id}-black.svg" width="180" height="180" alt="Omi · ${e.label}"></picture><p>${e.label}</p></article>`).join('');
await fs.writeFile(path.join(here,'embedding.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Omi · 外部图片嵌入</title><style>body{max-width:1000px;margin:40px auto;padding:0 20px;background:white;color:#151515;font:16px system-ui,sans-serif}.grid{display:flex;flex-wrap:wrap;gap:22px}article{text-align:center}label{display:block;margin:20px 0}pre{padding:20px;background:#f4f4f4;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>八种表情 · 外部 SVG 图片</h1><p>picture 在宿主页面中选择静态替代文件，可靠响应减少动态效果偏好。</p><label><input type="checkbox" id="static">手动显示静态版</label><div class="grid">${images}</div><pre>&lt;picture&gt;
  &lt;source media="(prefers-reduced-motion: reduce)"
          srcset="static/omi-curious-black.svg"&gt;
  &lt;img src="omi-curious-black.svg" width="80" height="80" alt="Omi · 疑惑"&gt;
&lt;/picture&gt;</pre><script>document.querySelector('#static').onchange=e=>document.querySelectorAll('source').forEach(s=>s.media=e.target.checked?'all':'(prefers-reduced-motion: reduce)');</script></html>`);
console.log('Created eight expressions: 24 animated SVGs + 24 static SVGs and previews');
