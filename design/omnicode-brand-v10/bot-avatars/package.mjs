import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const design = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(design, '../..');
const output = path.join(root, 'build/omi-filled-svg');
const resources = path.join(root, 'public/assets/omi/bots');
const shapes = JSON.parse(await fs.readFile(new URL('./shapes.json', import.meta.url), 'utf8'));
function shapeArtwork(svg, shape) {
  if (!shape.outline) return svg;
  svg = svg.replace(/(<path\b[^>]*\bd=")[^"]+/, `$1${shape.outline}`);
  if (!shape.faceTransform) return svg;
  const face = /<g class="(?:omx|omi)-a (?:omx|omi)-face">/.exec(svg);
  if (face) {
    let depth = 0, end = face.index;
    for (const match of svg.slice(face.index).matchAll(/<g\b[^>]*>|<\/g>/g)) {
      depth += match[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { end = face.index + match.index + match[0].length; break; }
    }
    const contents = svg.slice(face.index, end);
    return svg.slice(0, face.index) + `<g transform="${shape.faceTransform}">${contents}</g>` + svg.slice(end);
  }
  // The static ready master contains the outline followed by its eye path.
  let paths = 0;
  return svg.replace(/<path\b[^>]*\/>/g, path => ++paths === 2 ? `<g transform="${shape.faceTransform}">${path}</g>` : path);
}
function paintArtwork(svg, treatment, paint, faceInk) {
  svg = svg.replaceAll('currentColor', paint);
  if (treatment !== 'filled') return svg;
  svg = svg.replace(/<path\b[^>]*>/, path => path.replace('fill="none"', `fill="${paint}"`));
  if (/<g class="(?:omx|omi)-a (?:omx|omi)-face"/.test(svg)) {
    return svg.replace(/(<g class="(?:omx|omi)-a (?:omx|omi)-face")/, `$1 fill="${faceInk}" stroke="${faceInk}"`);
  }
  let paths = 0;
  return svg.replace(/<path\b[^>]*\/>/g, path => ++paths === 2 ? `<g fill="${faceInk}" stroke="${faceInk}">${path}</g>` : path);
}
const roster = [
  ['ready', '经典', '#7958ad', '轻浮、左右转动、眨眼'],
  ['curious', '好奇', '#3c72ab', '歪头、眨眼、轻浮'],
  ['focused', '专注', '#287f78', '扫视、点头、转身、眨眼'],
  ['joyful', '开心', '#99651d', '双弹跳、摇摆、弯眼眨眼'],
  ['encouraging', '鼓励', '#ae5679', '点头、摇摆、眨眼、爱心轻浮'],
  ['sleepy', '困倦', '#5c7c3c', '慢呼吸、低头、摇晃、眨眼'],
  ['inspired', '灵感', '#7958ad', '上浮、点头、摇摆、眨眼'],
  ['surprised', '惊讶', '#3c72ab', '弹跳、左右晃动、快速眨眼'],
];
const variants = ['color', 'black', 'white', 'current'];
for (const destination of [output, resources]) {
  await fs.mkdir(path.join(destination, 'animated'), { recursive: true });
  await fs.mkdir(path.join(destination, 'static'), { recursive: true });
}
const cards = [], manifest = [];
for (const [id, label, color, actions] of roster) {
  const source = path.join(design, id === 'ready' ? 'animated' : 'expressions-8');
  const animated = await fs.readFile(path.join(source, `omi-${id}-current.svg`), 'utf8');
  const still = await fs.readFile(path.join(source, 'static', `omi-${id}-current.svg`), 'utf8');
  for (const treatment of ['filled', 'outline']) {
  for (const shape of shapes) {
  const shapedAnimated = shapeArtwork(animated, shape);
  const shapedStatic = shapeArtwork(still, shape);
  for (const variant of variants) {
    const paint = variant === 'color' ? color : variant === 'black' ? '#151515' : variant === 'white' ? '#ffffff' : 'currentColor';
    const faceInk = variant === 'white' ? '#151515' : variant === 'current' ? 'var(--omi-face-color, #ffffff)' : '#ffffff';
    for (const [folder, svg] of [['animated', shapedAnimated], ['static', shapedStatic]]) {
      const artwork = paintArtwork(svg, treatment, paint, faceInk);
      for (const destination of [output, resources]) {
        await fs.writeFile(path.join(destination, folder, `omi-${shape.id}-${id}-${treatment}-${variant}.svg`), artwork);
      }
    }
  }
  manifest.push({ id, treatment, shape: shape.id, label, shapeLabel: shape.label, color, actions: `${actions}、左右看`, variants, viewBox: '0 0 320 320', transparent: true });
  cards.push(`<article data-expression="${id}" data-shape="${shape.id}" data-treatment="${treatment}"><div class="art" style="color:${color}">${paintArtwork(shapedAnimated, treatment, 'currentColor', '#ffffff')}</div><h2>${shape.label}<small>${label} · ${treatment === 'filled' ? '填充' : '线框'}</small></h2><p>${actions}、左右看</p><div class="sizes">${[24, 36, 64].map(size => `<img alt="${label} ${size}px" width="${size}" height="${size}" src="static/omi-${shape.id}-${id}-${treatment}-color.svg">`).join('')}</div></article>`);
  }
  }
}
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(resources, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(resources, 'README.txt'), `Omi · Bots 正式头像资源

4 种轮廓 × 8 种表情 × 线框/填充 2 款 × 彩色/黑/白/currentColor 4 版。
animated/：256 个透明动画 SVG；static/：256 个静态 SVG。
所有轮廓保留右下缺口；填充款表情使用对比色，主体外部仍透明。
动画包括左右看、眨眼、摇晃和浮动，支持 prefers-reduced-motion。

文件名：omi-{shape}-{expression}-{outline|filled}-{color|black|white|current}.svg
详细分类见 manifest.json。
网页资源路径示例：/assets/omi/bots/animated/omi-circle-joyful-filled-color.svg
外部图片建议通过 picture 配合 static/ 目录响应减少动态效果。
currentColor 版用于内联；填充款可用 --omi-face-color 自定义表情颜色。

应用内 BotAvatar 通过共享 Omi 组件使用同源矢量，保留主题配色、稳定身份、
离屏暂停和减少动态效果，并保留用户自定义头像。正式头像不引用 build/ 文件。

源文件：design/omnicode-brand-v10/animated/、expressions-8/、bot-avatars/shapes.json。
更新应用矢量：python scripts/generate-omnicode-artwork.py
更新本目录及预览包：node design/omnicode-brand-v10/bot-avatars/package.mjs
`);
await fs.writeFile(path.join(output, '使用说明.txt'), `Omi 透明 SVG 多动作动画包

包含经典、圆形、圆角三角形、圆角正方形，搭配 8 种表情，搭配线框与填充两款，共 64 个形象。每个提供彩色、黑色、白色、currentColor 四版。
animated/：256 个独立动画 SVG；static/：256 个静态替代 SVG。
SVG 不含背景、外链、字体依赖或脚本。填充款只填实主体内部，主体外与右下角缺口仍透明。彩色与黑色填充款使用白色表情，白色填充款使用深色表情。preview.html 的网格底色仅用于检查透明度。
直接用浏览器打开 preview.html 即可观看动画；点击“检查动画”需通过本地 HTTP 服务打开。

每个形象均组合身体转动/摇晃、浮动/弹跳、眨眼以及眼睛左看右看。
经典版周期 2.88 秒，困倦版 6 秒，其余 4.8 秒；动作之间留有停顿。
开心版沿用已确认的弯眼笑脸，眨眼不会压缩嘴部。
内联 SVG 根元素 data-paused="true" 暂停，data-motion="off" 显示静态。
SVG 内置 prefers-reduced-motion，外部 img 建议同时使用 picture 静态替代：

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="static/omi-circle-joyful-filled-color.svg">
  <img src="animated/omi-circle-joyful-filled-color.svg" width="96" height="96" alt="开心 Omi">
</picture>

currentColor 版用于内联 SVG，可由宿主文字颜色染色；填充款可用 --omi-face-color 设置表情颜色，默认白色；外部 img 请使用彩色/黑色/白色版。
生产页面已复用共享 Omi，离屏暂停与减少动态效果仍由共享组件处理。
`);
const checks = await fs.readFile(new URL('./preview-checks.js', import.meta.url), 'utf8');
await fs.writeFile(path.join(output, 'preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Omi · 透明多动作 SVG</title>
<style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#f7f7f3;color:#242722;font:15px system-ui,sans-serif}main{max-width:1180px;margin:auto}h1{font-size:27px;margin:0 0 8px}header p{color:#6e7369}nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:22px 0}button{font:inherit;padding:8px 14px;border:1px solid #c9cec4;border-radius:8px;background:#fff;color:#242722;cursor:pointer}button:focus-visible{outline:2px solid #477bb4;outline-offset:3px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}article{padding:16px;border:1px solid #dfe3da;background:#fff;border-radius:16px}.art{display:grid;place-items:center;height:164px;border-radius:10px;background:repeating-conic-gradient(#a6ad9b18 0% 25%,transparent 0% 50%) 0/16px 16px}.art>svg{width:160px;height:160px}h2{display:flex;justify-content:space-between;align-items:center;font-size:18px;margin:14px 0 8px}small,p{font-size:12px;color:#73796b}article p{min-height:30px;margin:0}.sizes{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:8px;min-height:64px}.dark{background:#20231e;color:#ecefe8}.dark article{background:#2b3027;border-color:#434b3c}.dark p,.dark small{color:#bac2b2}.dark .art{background-color:#ecefe8}pre{white-space:pre-wrap;font-size:12px}a{color:inherit}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){body{padding:16px}.grid{grid-template-columns:1fr}}@media(min-width:901px) and (max-height:800px){body{padding:20px}nav{margin:12px 0}.art{height:110px}.art>svg{width:110px;height:110px}article{padding:12px}h2{margin:8px 0 4px}article p{min-height:24px}.sizes{min-height:48px;margin-top:4px}.sizes img{max-width:48px;max-height:48px}}@media(min-width:600px) and (max-width:900px){body{padding:16px}.grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}article{padding:8px}.art{height:90px}.art>svg{width:90px;height:90px}h2{font-size:14px;display:block;margin:8px 0 4px}h2 small{display:block}article p{min-height:46px;font-size:11px}.sizes{min-height:32px;gap:8px}.sizes img{max-width:32px;max-height:32px}nav{margin:12px 0}}</style>
<main><header><h1>Omi · 透明多动作 SVG</h1><p>填充款 + 线框款 · 4 种轮廓 × 8 种表情 · 对比色五官 · 保留右下缺口</p></header><nav><button id="pause" aria-pressed="false">暂停动画</button><button id="static" aria-pressed="false">静态模式</button><button id="theme">切换背景</button><button id="check">检查动画</button><a href="manifest.json">素材清单</a></nav><section class="grid">${cards.join('')}</section><pre id="report" aria-live="polite"></pre></main><script>${checks}</script></html>`);
console.log(`Exported 256 animated SVGs, 256 static SVGs and preview to ${output}`);
console.log(`Saved project resources to ${resources}`);
