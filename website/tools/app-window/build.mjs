// Builds website/app-window/ from the fixture captures (snap*.json, picker*.json).
// Usage from the repo root: node website/tools/app-window/build.mjs <capture-dir>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [captureDir] = process.argv.slice(2);
const out = "website/app-window";
const zh = JSON.parse(readFileSync(`${captureDir}/snap.json`, "utf8"));
const en = JSON.parse(readFileSync(`${captureDir}/snap-en.json`, "utf8"));
const picker = {
  "zh-CN": JSON.parse(readFileSync(`${captureDir}/picker.json`, "utf8")),
  en: JSON.parse(readFileSync(`${captureDir}/picker-en.json`, "utf8")),
};
// app.js builds every harness list from the Claude rows (selected + plain).
for (const data of Object.values(picker)) data.states = { "Claude Code": { list: data.states["Claude Code"].list } };
// Icons over Vite's inline limit were captured as dev-server paths.
const localIcons = (markup) => markup.replaceAll("/src/assets/providers/", "providers/");
mkdirSync(`${out}/providers`, { recursive: true });
for (const id of ["antigravity", "hermes"]) copyFileSync(`src/assets/providers/${id}.svg`, `${out}/providers/${id}.svg`);
// Keep "</script>" inside the JSON from closing the script element.
const pickerJson = localIcons(JSON.stringify(picker)).replace(/<\//g, "<\\/");

const fonts = {
  "/fonts/source-sans/SourceSans3VF-Upright.ttf.woff2": "SourceSans3VF-Upright.ttf.woff2",
  "/fonts/source-serif/SourceSerif4Variable-Roman.ttf.woff2": "SourceSerif4Variable-Roman.ttf.woff2",
  "/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2": "JetBrainsMono-Regular.woff2",
};
mkdirSync(`${out}/fonts`, { recursive: true });
for (const [source, name] of Object.entries(fonts)) copyFileSync(`public${source}`, `${out}/fonts/${name}`);
copyFileSync("public/fonts/source-sans/OFL.txt", `${out}/fonts/SourceSans3-OFL.txt`);
copyFileSync("public/fonts/source-serif/OFL.txt", `${out}/fonts/SourceSerif4-OFL.txt`);
copyFileSync("public/fonts/jetbrains-mono/OFL.txt", `${out}/fonts/JetBrainsMono-OFL.txt`);

// Keep the three faces the window uses; drop italic and heavier mono faces.
let css = zh.css.replace(/@font-face\s*\{[^}]*\}\n?/g, (block) => {
  const url = block.match(/url\("?([^")]+)"?\)/)?.[1];
  return url && fonts[url] ? block.replace(url, `fonts/${fonts[url]}`) : "";
});
const header = "/* OmniCode desktop window: rules from the app's own stylesheets that match\n   this snapshot (dark midnight and light daylight skins). Generated; do not edit. */\n";
writeFileSync(`${out}/app.css`, header + css);

const attrs = (list) => list.filter(([name]) => name !== "lang");
const themes = JSON.stringify({ dark: attrs(zh.dark), light: attrs(zh.light) });
const darkAttrs = attrs(zh.dark).map(([n, v]) => `${n}="${v.replace(/"/g, "&quot;")}"`).join(" ");

writeFileSync(
  `${out}/index.html`,
  `<!doctype html>
<html lang="zh-CN" ${darkAttrs}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1282" />
    <meta name="robots" content="noindex" />
    <title>OmniCode</title>
    <script id="themes" type="application/json">${themes}</script>
    <script>
      (() => {
        const themes = JSON.parse(document.getElementById("themes").textContent);
        const html = document.documentElement;
        const attrs = matchMedia("(prefers-color-scheme: light)").matches ? themes.light : themes.dark;
        for (const a of [...html.attributes]) if (a.name !== "lang") html.removeAttribute(a.name);
        for (const [n, v] of attrs) html.setAttribute(n, v);
        if (new URLSearchParams(location.search).get("lang") === "en") html.lang = "en";
      })();
    </script>
    <link rel="stylesheet" href="app.css" />
    <style>
      html, body { width: 1282px; height: 802px; margin: 0; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root">${localIcons(zh.body)}</div>
    <template id="root-en">${localIcons(en.body)}</template>
    <script id="picker-data" type="application/json">${pickerJson}</script>
    <script src="app.js"></script>
  </body>
</html>
`,
);
console.log("css", Math.round(css.length / 1024), "KB");
