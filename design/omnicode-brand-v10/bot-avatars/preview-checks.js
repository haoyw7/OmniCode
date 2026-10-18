const drawings = () => [...document.querySelectorAll('.art > svg')];
let paused = false, still = false;
document.querySelector('#pause').onclick = event => {
  paused = !paused;
  drawings().forEach(svg => svg.dataset.paused = String(paused));
  event.currentTarget.textContent = paused ? '继续动画' : '暂停动画';
  event.currentTarget.setAttribute('aria-pressed', String(paused));
};
document.querySelector('#static').onclick = event => {
  still = !still;
  drawings().forEach(svg => svg.dataset.motion = still ? 'off' : 'on');
  event.currentTarget.textContent = still ? '动画模式' : '静态模式';
  event.currentTarget.setAttribute('aria-pressed', String(still));
};
document.querySelector('#theme').onclick = () => document.body.classList.toggle('dark');
document.addEventListener('visibilitychange', () => drawings().forEach(svg => svg.dataset.paused = String(paused || document.hidden)));
document.querySelector('#check').onclick = async event => {
  const button = event.currentTarget, report = document.querySelector('#report');
  button.disabled = true;
  const results = [];
  try {
    if (still || matchMedia('(prefers-reduced-motion: reduce)').matches) throw new Error('当前为静态/减少动态效果模式，请关闭后检查动画。');
    for (const svg of drawings()) {
      const id = svg.closest('article').dataset.expression;
      const shape = svg.closest('article').dataset.shape;
      const treatment = svg.closest('article').dataset.treatment;
      const animations = svg.getAnimations({ subtree: true });
      const body = svg.querySelector('.omx-body, .omi-body');
      const eyes = svg.querySelector('.omx-blink, .omi-face');
      const gaze = svg.querySelector('.omx-gaze, .omi-gaze');
      const bodyStates = [], eyeStates = [], gazePositions = [];
      const saved = animations.map(animation => ({ animation, time: animation.currentTime, state: animation.playState }));
      try {
        for (const fraction of [0, .05, .15, .28, .4, .45, .74, .78, .83]) {
          animations.forEach(animation => { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * fraction; });
          bodyStates.push(getComputedStyle(body).transform);
          eyeStates.push(getComputedStyle(eyes).transform);
          gazePositions.push(new DOMMatrix(getComputedStyle(gaze).transform).m41);
        }
      } finally {
        saved.forEach(({ animation, time, state }) => { animation.currentTime = time; if (state === 'running') animation.play(); });
      }
      if (new Set(bodyStates).size < 3 || new Set(eyeStates).size < 2) throw new Error(`${id}: 动作采样不足`);
      if (!gazePositions.some(x => x < -1) || !gazePositions.some(x => x > 1)) throw new Error(`${shape}/${id}: 缺少左右看的动作`);
      svg.dataset.motion = 'off';
      const staticAnimations = svg.getAnimations({ subtree: true }).length;
      svg.dataset.motion = 'on';
      if (staticAnimations !== 0) throw new Error(`${id}: 静态模式仍有动画`);
      for (const variant of ['color', 'black', 'white', 'current']) {
        const img = new Image();
        img.src = `animated/omi-${shape}-${id}-${treatment}-${variant}.svg`;
        await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(img, 0, 0);
        const pixels = context.getImageData(0, 0, 320, 320).data;
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) painted++;
        if (pixels[3] || pixels[(319 * 320 + 319) * 4 + 3] || painted < 100 || painted > 65000) throw new Error(`${id}/${variant}: 透明度检查失败`);
      }
      const still = new Image();
      still.src = `static/omi-${shape}-${id}-${treatment}-color.svg`;
      await still.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(still, 0, 0);
      const notch = { original: [238, 239], circle: [238, 238], triangle: [246, 248], square: [249, 249] }[shape];
      if (context.getImageData(...notch, 1, 1).data[3] !== 0) throw new Error(`${shape}/${id}/${treatment}: 右下缺口不透明`);
      if (treatment === 'filled' && context.getImageData(160, 210, 1, 1).data[3] !== 255) throw new Error(`${shape}/${id}: 主体内部未填实`);
      results.push({ id, shape, treatment, notch: 'transparent', interior: treatment === 'filled' ? 'opaque' : 'outline', gazeRange: [Math.min(...gazePositions), Math.max(...gazePositions)], animationTracks: animations.length, bodyStates: new Set(bodyStates).size, eyeStates: new Set(eyeStates).size, transparentVariants: 4, staticMode: 'passed' });
    }
    report.textContent = JSON.stringify({ passed: true, browser: navigator.userAgent, results }, null, 2);
  } catch (error) { report.textContent = JSON.stringify({ passed: false, error: String(error), results }, null, 2); }
  finally { button.disabled = false; }
};
