// Static snapshot of the OmniCode desktop window, captured from the app's own
// fixtures. It plays one chat turn on a loop with the app's layout. The
// parent page sends { lang, visible } with postMessage.
const html = document.documentElement;
const root = document.getElementById("root");
const themes = JSON.parse(document.getElementById("themes").textContent);
const bodies = {
  "zh-CN": root.innerHTML,
  en: document.getElementById("root-en").innerHTML,
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const prefersLight = matchMedia("(prefers-color-scheme: light)");
const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
const copy = {
  "zh-CN": {
    newSession: "新会话",
    prompt: "桌面应用的会话缓存用 Redis 还是 SQLite？",
    title: "会话缓存选型",
    reply:
      "单机桌面应用建议先用 SQLite：随应用分发、无需额外服务。需要多实例共享或精细过期策略时，再考虑 Redis。",
  },
  en: {
    newSession: "New session",
    prompt: "Redis or SQLite for session caching in a desktop app?",
    title: "Session cache choice",
    reply:
      "Start with SQLite for a single-machine desktop app: it ships with the app and needs no extra service. Reach for Redis when several instances share the cache or you need fine-grained expiry.",
  },
};
const pickerData = JSON.parse(document.getElementById("picker-data").textContent);
// The picker steps through every harness and settles back on Codex.
const harnessTour = ["Claude Code", "Cursor", "Grok Build", "OpenCode", "Pi", "omp", "fx", "Hermes Agent", "Antigravity", "Codex"];
// Mock model lists. Bundled fallbacks (src/features/sessions/model/models.ts)
// come first; live catalogs supply the rest in the app, so they are filled in
// here. GPT-6-Astra on Codex is the current model.
const harnessModels = {
  "Claude Code": ["Claude Sonnet 5", "Claude Opus 5", "Claude Opus 5.5", "Claude Fable 5", "Opus 4.6", "Sonnet 4.6", "Haiku 4.5", "Opus 4.5"],
  Codex: ["GPT-6-Astra", "gpt-5.6-luna", "gpt-5.6-terra", "GPT-5.5", "GPT-5.5 mini"],
  Cursor: ["Composer 2.5", "GPT-5.4", "Sonnet 4.6", "Cursor Grok 4.6", "Gemini 3.8 Pro", "Auto"],
  "Grok Build": ["Grok 4.6", "Grok 4.5", "Grok Code Fast 2", "Grok 4.6 Heavy"],
  OpenCode: ["GLM 5", "MiniMax M2.5", "Kimi K2.5", "DeepSeek V4 Flash", "Qwen 3.5", "Grok 4.5", "Claude Sonnet 4.6", "GPT-5.4"],
  Pi: ["Default", "Claude Sonnet 5", "GPT-5.6", "Gemini 3.8 Pro", "DeepSeek V4"],
  omp: ["Default", "Claude Opus 5", "GPT-5.6", "Kimi K2.5"],
  fx: ["GLM 5.2 Fast", "GLM 5.2", "GLM 5.2 Air"],
  "Hermes Agent": ["Configured model", "Hermes 5 405B", "Hermes 5 70B"],
  Antigravity: ["Gemini 3.8 Flash (High)", "Gemini 3.8 Pro (High)", "Gemini 3.8 Pro (Low)", "Claude Sonnet 5 (Thinking)"],
};
const currentModel = { harness: "Codex", model: "GPT-6-Astra" };
const cancelled = Symbol("cancelled");
let lang = html.lang === "en" ? "en" : "zh-CN";
let visible = true;
let runId = 0;

function applyTheme() {
  const attrs = prefersLight.matches ? themes.light : themes.dark;
  for (const a of [...html.attributes]) if (a.name !== "lang") html.removeAttribute(a.name);
  for (const [name, value] of attrs) html.setAttribute(name, value);
}

const q = (selector) => root.querySelector(selector);
const qa = (selector) => [...root.querySelectorAll(selector)];
const pane = (name) => q(`[data-snap-pane="${name}"]`);

function showPane(name) {
  for (const each of ["empty", "run", "conv"]) pane(each).hidden = each !== name;
}

/* Model picker: the app's own popover markup, one model list per harness. */
let picker = null;

// Build a harness list from the captured rows: the fixture's selected row
// (with its check) and a plain row.
function modelList(captured, harness) {
  const template = document.createElement("template");
  template.innerHTML = captured;
  const group = template.content.querySelector('[role="group"]');
  group.setAttribute("aria-label", harness);
  const rows = [...group.querySelectorAll("[data-menu-row]")];
  const selected = rows.find((row) => row.querySelector('[role="option"][aria-selected="true"]'));
  const plain = rows.find((row) => row !== selected);
  rows.forEach((row) => row.remove());
  for (const model of harnessModels[harness]) {
    const current = harness === currentModel.harness && model === currentModel.model;
    const row = (current ? selected : plain).cloneNode(true);
    row.querySelector('[role="option"]').setAttribute("aria-label", `${model}, ${harness}`);
    row.querySelector("[data-menu-title]").textContent = model;
    group.append(row);
  }
  return template.innerHTML;
}

function buildPicker() {
  const data = pickerData[lang];
  const template = document.createElement("template");
  template.innerHTML = data.portal.trim();
  const portal = template.content.firstElementChild;
  portal.hidden = true;
  root.append(portal);
  // The Claude list holds both a selected and a plain row to copy from.
  const lists = Object.fromEntries(
    Object.keys(harnessModels).map((name) => [name, modelList(data.states["Claude Code"].list, name)]),
  );
  // The chat section's collapse kept the fixture's mid-animation height;
  // let it size to its rows so the session row is never clipped.
  const row = q("[data-snap-row]");
  row.closest(".project-tree-collapse").style.height = "auto";
  // Dense rows end with the unread dot after the actions, as SessionCard
  // does, and the open session's row is the active one.
  row.querySelector("[data-session-card]").append(q("[data-snap-unread]"));
  row.querySelector("[data-session-card]").setAttribute("data-session-active", "true");
  row.querySelector("[data-session-select]").setAttribute("aria-current", "true");
  picker = {
    portal,
    dialog: portal.querySelector('[role="dialog"]'),
    list: portal.querySelector('[role="group"]').parentElement,
    lists,
    gap: data.gap,
  };
}

function selectHarness(name) {
  for (const tab of picker.portal.querySelectorAll('[role="tab"]')) {
    const selected = tab.getAttribute("aria-label") === name;
    tab.setAttribute("aria-selected", String(selected));
    // Scroll the overflowing tab strip without moving the host page.
    if (selected) {
      const strip = tab.parentElement;
      strip.scrollTo({
        left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2,
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    }
  }
  picker.list.innerHTML = picker.lists[name] ?? "";
  picker.list.scrollTop = 0;
}

function modelTrigger() {
  return pane("empty").querySelector("[data-model-picker-trigger]");
}

// Popovers open and close in 0.2s from the trigger's corner.
function openPicker() {
  const trigger = modelTrigger().getBoundingClientRect();
  const height = document.documentElement.clientHeight;
  picker.portal.hidden = false;
  selectHarness("Codex");
  picker.portal.style.left = `${trigger.right - picker.portal.offsetWidth - picker.gap.right}px`;
  picker.portal.style.bottom = `${height - trigger.top + picker.gap.bottom}px`;
  modelTrigger().setAttribute("aria-expanded", "true");
  picker.dialog.animate(
    [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }],
    { duration: 200, easing: ease },
  );
}

async function closePicker(id) {
  modelTrigger().setAttribute("aria-expanded", "false");
  const fade = picker.dialog.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.96)" }],
    { duration: 200, easing: ease, fill: "forwards" },
  );
  await wait(200, id);
  picker.portal.hidden = true;
  fade.cancel();
}

// Message entry: 0.18s with the project easing.
const enter = (element) =>
  element?.animate(
    [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
    { duration: 180, easing: ease },
  );

// Time only advances while the window is on screen and the page is visible.
async function wait(ms, id) {
  let left = ms;
  while (left > 0) {
    if (id !== runId) throw cancelled;
    const step = Math.min(left, 50);
    await new Promise((resolve) => setTimeout(resolve, step));
    if (visible && !document.hidden) left -= step;
  }
  if (id !== runId) throw cancelled;
}

function reset() {
  const text = copy[lang];
  showPane("empty");
  const input = q("[data-snap-input]");
  input.value = "";
  input.dataset.composerEmpty = "true";
  pane("empty").querySelector(".composer-send").disabled = true;
  q("[data-snap-title]").textContent = text.newSession;
  q("[data-snap-row]").hidden = true;
  q("[data-snap-unread]").hidden = true;
  q("[data-snap-session]").textContent = text.title;
  qa("[data-snap-prompt]").forEach((element) => (element.textContent = text.prompt));
  qa("[data-snap-reply]").forEach((element) => (element.textContent = ""));
  picker.portal.hidden = true;
  picker.dialog.getAnimations().forEach((animation) => animation.cancel());
  modelTrigger().setAttribute("aria-expanded", "false");
}

function showFinished() {
  reset();
  const text = copy[lang];
  showPane("conv");
  q("[data-snap-title]").textContent = text.title;
  q("[data-snap-row]").hidden = false;
  q("[data-snap-unread]").hidden = false;
  pane("conv").querySelector("[data-snap-reply]").textContent = text.reply;
}

async function play(id) {
  for (;;) {
    const text = copy[lang];
    reset();
    await wait(1200, id);
    openPicker();
    await wait(700, id);
    for (const name of harnessTour) {
      selectHarness(name);
      await wait(name === "Codex" ? 900 : 520, id);
    }
    await closePicker(id);
    await wait(600, id);
    const input = q("[data-snap-input]");
    const send = pane("empty").querySelector(".composer-send");
    input.dataset.composerEmpty = "false";
    send.disabled = false;
    for (const character of text.prompt) {
      input.value += character;
      await wait(lang === "en" ? 38 : 85, id);
    }
    await wait(500, id);

    showPane("run");
    q("[data-snap-title]").textContent = text.title;
    enter(pane("run").querySelector(".user-message-row"));
    const row = q("[data-snap-row]");
    row.hidden = false;
    // New sidebar rows use the AutoAnimate default entry.
    row.animate(
      [{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }],
      { duration: 250, easing: "ease-in-out" },
    );
    await wait(900, id);

    const reply = pane("run").querySelector("[data-snap-reply]");
    const chunks = lang === "en" ? text.reply.match(/\S+\s*/g) : [...text.reply];
    for (const chunk of chunks) {
      reply.textContent += chunk;
      await wait(lang === "en" ? 60 : 34, id);
    }
    await wait(400, id);

    pane("conv").querySelector("[data-snap-reply]").textContent = text.reply;
    showPane("conv");
    q("[data-snap-unread]").hidden = false;
    await wait(6000, id);
  }
}

function restart() {
  const id = ++runId;
  if (reducedMotion.matches) {
    showFinished();
    return;
  }
  play(id).catch((error) => {
    if (error !== cancelled) throw error;
  });
}

function setLanguage(next) {
  const value = next === "en" ? "en" : "zh-CN";
  if (value === lang && root.dataset.lang === value) return;
  lang = value;
  html.lang = lang;
  root.innerHTML = bodies[lang];
  root.dataset.lang = lang;
  buildPicker();
  restart();
}

addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "omnicode-preview") return;
  if ("visible" in data) visible = !!data.visible;
  if (data.lang) setLanguage(data.lang);
});
prefersLight.addEventListener?.("change", applyTheme);
reducedMotion.addEventListener?.("change", restart);

if (lang === "en") root.innerHTML = bodies.en;
root.dataset.lang = lang;
buildPicker();
restart();
