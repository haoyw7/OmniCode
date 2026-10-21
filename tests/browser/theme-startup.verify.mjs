import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

// Real browser pre-paint check, deliberately holding all modules so neither
// React nor Host initialization can mask a wrong initial frame. No build.
const browser = await chromium.launch({ headless: true });
const servers = [];
const results = [];
try {
  for (const mobile of [false, true]) {
    const server = await createServer({
      configFile: mobile ? 'vite.mobile.config.ts' : 'vite.config.ts',
      optimizeDeps: { noDiscovery: true, include: [], entries: [] },
      server: { host: '127.0.0.1', port: mobile ? 1479 : 1478, strictPort: true, open: false, hmr: false, watch: null },
    });
    servers.push(server);
    await server.listen();
    const address = server.httpServer.address();
    const base = `http://127.0.0.1:${address.port}`;
    for (const entry of mobile ? ['mobile.html'] : ['index.html', 'quick-composer.html']) {
      for (const scenario of [
        { preference: 'light', system: 'dark', scheme: 'light', skin: 'auto' },
        { preference: 'dark', system: 'light', scheme: 'dark', skin: 'auto' },
        { preference: 'system', system: 'light', scheme: 'light', skin: 'auto' },
        { preference: 'system', system: 'dark', scheme: 'dark', skin: 'auto' },
        { preference: 'dark', system: 'dark', scheme: 'light', skin: 'atelier' },
        { preference: 'light', system: 'light', scheme: 'dark', skin: 'foundry' },
      ]) {
        const context = await browser.newContext({ colorScheme: scenario.system });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().resourceType() === 'script'
          ? route.abort() : route.continue());
        await page.addInitScript(({ mobile, scenario }) => {
          localStorage.setItem(mobile ? 'omnicode.colorScheme' : 'omnicode.desktopColorScheme', scenario.preference);
          localStorage.setItem(mobile ? 'omnicode.mobile.skin' : 'omnicode.desktopSkin', scenario.skin);
          window.themeFrames = [];
          const sample = () => {
            const root = document.documentElement;
            if (root) window.themeFrames.push({
              className: root.className,
              skin: root.dataset[mobile ? 'mobileSkin' : 'skin'],
              background: getComputedStyle(document.getElementById('boot-splash') ?? root).backgroundColor,
              colorScheme: getComputedStyle(root).colorScheme,
            });
            if (window.themeFrames.length < 4) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, { mobile, scenario });
        await page.goto(`${base}/${entry}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.themeFrames.length >= 4);
        const frames = await page.evaluate(() => window.themeFrames);
        assert.deepEqual(errors, [], `${entry}: bootstrap errors`);
        const expectedSkin = scenario.skin !== 'auto' ? scenario.skin : scenario.scheme === 'light' ? 'daylight' : mobile ? 'midnight' : 'ripple';
        const grounds = { daylight: 'rgb(249, 249, 247)', midnight: 'rgb(38, 38, 36)', ripple: 'rgb(7, 16, 24)', atelier: 'rgb(245, 241, 235)', foundry: 'rgb(16, 14, 11)' };
        for (const frame of frames) {
          assert(frame.className.split(' ').includes(`theme-${scenario.scheme}`), JSON.stringify({ entry, scenario, frame }));
          assert.equal(frame.skin, expectedSkin);
          assert.equal(frame.background, grounds[expectedSkin]);
          assert.equal(frame.colorScheme, scenario.scheme);
        }
        results.push(`${entry} ${scenario.preference}/${scenario.system}/${scenario.skin}: ${frames.length} frames correct`);
        console.log(results.at(-1));
        await context.close();
      }
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), checks: results }, null, 2));
} finally {
  await browser.close();
  await Promise.all(servers.map(server => server.close()));
}
