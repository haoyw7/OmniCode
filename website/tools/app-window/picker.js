// Runs in desktop-visual.html (empty chat). Opens the real model picker and
// records its markup plus the tab strip and model list for every harness.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const trigger = document.querySelector("[data-model-picker-trigger]");
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  let dialog;
  for (let i = 0; i < 40 && !dialog; i++) {
    await sleep(250);
    dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector('[aria-label="Codex"]'));
  }
  let portal = dialog;
  while (portal.parentElement !== document.body) portal = portal.parentElement;
  const tabs = [...dialog.querySelectorAll("[aria-label]")].filter((b) => /^(Claude Code|Codex|Cursor|Grok Build|OpenCode|Pi|omp|fx|Hermes Agent|Antigravity)$/.test(b.getAttribute("aria-label")));
  const names = tabs.map((tab) => tab.getAttribute("aria-label"));
  const tabFor = (name) => [...dialog.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label") === name && e.getAttribute("role") === "tab");
  const findList = (name) => {
    const row = [...dialog.querySelectorAll("button[aria-label]")].find((b) => b.getAttribute("aria-label").endsWith(", " + name));
    if (!row) return null;
    const strip = tabFor(name).parentElement;
    let list = row;
    while (list.parentElement && !list.parentElement.contains(strip)) list = list.parentElement;
    return list;
  };
  const states = {};
  for (const name of names) {
    tabFor(name).click();
    let list = null;
    for (let i = 0; i < 40 && !list; i++) { await sleep(150); list = findList(name); }
    await sleep(300);
    list = findList(name);
    const strip = tabFor(name).parentElement;
    states[name] = {
      strip: strip.innerHTML,
      list: list ? list.innerHTML : null,
      listClass: list ? list.className : null,
      rows: list ? [...list.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((x) => x.endsWith(", " + name)) : [],
    };
  }
  const trig = trigger.getBoundingClientRect();
  const box = dialog.getBoundingClientRect();
  const data = {
    portal: portal.outerHTML,
    gap: { right: Math.round(trig.right - box.right), bottom: Math.round(trig.top - box.bottom) },
    states,
  };
  await fetch("http://127.0.0.1:4199/?name=picker" + (document.documentElement.lang === "en" ? "-en" : "") + ".json", { method: "POST", body: JSON.stringify(data) });
  return { gap: data.gap, rows: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.rows.slice(0, 4)])) };
})();
