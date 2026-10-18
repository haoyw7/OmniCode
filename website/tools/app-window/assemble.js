// Runs inside tests/browser/desktop-visual.html (empty chat state). Turns the
// live fixture DOM into the window from the real screenshot, adds animation
// templates, prunes the page CSS to the rules this DOM uses, and posts it.
(async () => {
  const base = "http://127.0.0.1:4199/?name=";
  const get = (name) => fetch(base + name).then((r) => r.text());
  const post = (name, body) => fetch(base + name, { method: "POST", body });
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const html = document.documentElement;
  const en = html.lang === "en";
  const suffix = en ? "-en" : "";
  const T = en
    ? { greeting: "What should we work on?", access: "Full access", effort: "High", workflows: "Workflows", running: "GPT-6-Astra running… · 2s" }
    : { greeting: "我们来做些什么？", access: "完全访问", effort: "高", workflows: "工作流", running: "GPT-6-Astra 正在运行… · 2s" };
  const codexSvg = await fetch("/src/assets/providers/codex.svg").then((r) => r.text());
  const codexUri = "data:image/svg+xml," + encodeURIComponent(codexSvg).replace(/'/g, "%27");
  const parse = (markup) => {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstElementChild;
  };

  /* Sidebar 224px wide (resize width 232 minus the 8px inset). */
  for (const el of $$("[style]")) {
    let s = el.getAttribute("style");
    s = s.replaceAll("256px", "232px").replace("--desktop-sidebar-chrome-width: 248px", "--desktop-sidebar-chrome-width: 224px");
    if (s.trim() === "left: 248px;") s = "left: 224px;";
    el.setAttribute("style", s);
  }

  /* Titlebar: app background across the window, tab inside it, more button. */
  const header = $("header");
  header.style.backgroundColor = "var(--color-background-base)";
  const tab = $$(".surface-tab").find((t) => t.getBoundingClientRect().height > 0);
  const tabWrap = tab.parentElement;
  const strip = tabWrap.closest(".min-w-0.shrink-0");
  tabWrap.style.marginLeft = "7px";
  tabWrap.style.height = "auto";
  header.children[1].append(tabWrap);
  strip.remove();
  const tabTitle = tab.querySelector("span.truncate");
  tabTitle.setAttribute("data-snap-title", "");
  tabTitle.textContent = en ? "New session" : "新会话";
  tab.removeAttribute("title");
  const search = $("[data-sidebar-footer-search]");
  const more = search.cloneNode(true);
  more.removeAttribute("data-sidebar-footer-search");
  const ellipsis = parse(await get("session-row" + suffix + ".html")).querySelector("svg.lucide-ellipsis");
  more.querySelector("svg").replaceWith(ellipsis.cloneNode(true));
  more.style.marginRight = "3px";
  more.setAttribute("aria-label", en ? "More" : "更多");
  more.setAttribute("title", en ? "More" : "更多");
  header.children[2].prepend(more);

  /* Sidebar sections as in the real window: no empty hints, plus Workflows. */
  const hints = $$("aside p").filter((p) => /拖到这里置顶|你开始的聊天|here to pin them|will show up here/i.test(p.textContent));
  hints.forEach((p) => p.remove());
  const labelOf = (text) => $$("aside span").find((s) => s.childElementCount === 0 && s.textContent.trim() === text);
  const pinned = labelOf(en ? "Pinned items" : "置顶");
  const chats = labelOf(en ? "Chats" : "聊天");
  let pinnedSection = pinned, chatsSection = chats;
  while (pinnedSection.parentElement && !pinnedSection.parentElement.contains(chats)) pinnedSection = pinnedSection.parentElement;
  while (chatsSection.parentElement && !chatsSection.parentElement.contains(pinned)) chatsSection = chatsSection.parentElement;
  const workflows = pinnedSection.cloneNode(true);
  const wfLabel = $$("span", workflows).find((s) => s.childElementCount === 0 && s.textContent.trim() === pinned.textContent.trim());
  wfLabel.textContent = T.workflows;
  chatsSection.after(workflows);

  /* A real session row under Chats, revealed by the animation. */
  const row = parse(await get("session-row" + suffix + ".html"));
  const card = $("[data-session-card]", row);
  card.removeAttribute("data-session-layout");
  card.setAttribute("data-session-active", "false");
  $("[data-session-project]", row)?.remove();
  const avatar = $("[data-session-avatar]", row);
  avatar.setAttribute("aria-label", "Codex");
  avatar.setAttribute("title", "Codex");
  $("img", avatar).src = codexUri;
  $(".desktop-sidebar-session-title", row).setAttribute("data-snap-session", "");
  const statusSlot = $$("span", row).find((s) => s.className === "flex shrink-0 items-center gap-1.5");
  statusSlot.innerHTML = '<span role="img" data-snap-unread="" class="size-1.5 shrink-0 rounded-full bg-sky-500"></span>';
  row.setAttribute("data-snap-row", "");
  row.hidden = true;
  // Chat rows live inside the section's collapse, which sizes to its rows.
  const chatsFold = $(".project-tree-collapse", chatsSection);
  chatsFold.style.height = "auto";
  chatsFold.firstElementChild.append(row);

  /* Footer: pending update badge over the Settings row. */
  const settingsWrap = $("[data-activity-settings]");
  const settingsIcon = $("svg", settingsWrap);
  const badge = parse(`<button type="button" aria-label="${en ? "Update available" : "有可用更新"}" class="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md transition-colors text-accent hover:bg-surface-hover"><span aria-hidden="true" class="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-sky-500"></span></button>`);
  const updateIcon = settingsIcon.cloneNode(false);
  updateIcon.setAttribute("class", "lucide lucide-circle-arrow-down size-4");
  updateIcon.innerHTML = '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v8"></path><path d="m8 12 4 4 4-4"></path>';
  badge.prepend(updateIcon);
  settingsWrap.append(badge);

  // The real window keeps the composer 5px higher than the fixture.
  const liftComposer = (root) => {
    const lane = $(".desktop-composer-lane", root) ?? $("[data-ui=\"message-input\"]", root)?.closest("[data-composer]");
    if (lane) lane.style.paddingBottom = "5px";
  };

  /* Composer: ~ folder, full access, GPT-6-Astra on Codex. */
  function dressComposer(root) {
    $(".cwd-picker-clear", root)?.remove();
    for (const s of $$("[class*='cwd-picker'] span, .composer-workspace-trigger span", root)) {
      if (s.childElementCount === 0 && /chat-0900|fixture/.test(s.textContent)) s.textContent = "~";
    }
    const accessBtn = $("[data-access-picker-trigger]", root) ?? $$("button", root).find((b) => /逐项审批|Supervised/.test(b.textContent));
    if (accessBtn) {
      const icon = $("svg", accessBtn);
      icon.innerHTML = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 4 7v6c0 3 4 5.5 8 7 4-1.5 8-4 8-7V7l-8-3Z" stroke-width="1.5"></path></g>';
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.classList.add("text-amber-400/90");
      $$("span", accessBtn).find((s) => s.childElementCount === 0 && s.textContent.trim()).textContent = T.access;
      accessBtn.setAttribute("aria-label", T.access);
    }
    const modelBtn = $("[data-model-picker-trigger]", root);
    if (modelBtn) {
      $("img", modelBtn).src = codexUri;
      $(".model-picker-name", modelBtn).textContent = "GPT-6-Astra";
      modelBtn.setAttribute("aria-label", "Codex GPT-6-Astra");
      modelBtn.removeAttribute("title");
      const effort = document.createElement("span");
      effort.className = "model-picker-trigger-text shrink-0 text-[11px] text-content/50";
      effort.textContent = T.effort;
      $(".model-picker-name", modelBtn).after(effort);
      const loader = $("svg.lucide-loader-circle, svg[class*='loader']", modelBtn);
      const chevron = $("svg.lucide-chevron-down", accessBtn ?? root)?.cloneNode(true);
      if (loader && chevron) loader.replaceWith(chevron);
    }
  }
  const emptyPane = $$(".desktop-session-pane").find((p) => p.getBoundingClientRect().height > 0);
  dressComposer(emptyPane);
  liftComposer(emptyPane);
  $("h1", emptyPane).textContent = T.greeting;
  $("h1", emptyPane).removeAttribute("title");
  $("textarea", emptyPane).setAttribute("data-snap-input", "");
  emptyPane.setAttribute("data-snap-pane", "empty");

  /* Running and finished panes for the animation, without the status rail. */
  for (const name of ["run", "conv"]) {
    const pane = parse(await get(name + "-pane" + suffix + ".html"));
    pane.setAttribute("data-snap-pane", name);
    pane.hidden = true;
    const statusRow = $("[data-session-status-row]", pane);
    if (statusRow && statusRow.children.length > 1) statusRow.lastElementChild.remove();
    const turn = $(".transcript-turn", pane);
    const kids = [...turn.children];
    if (name === "conv") {
      kids[1]?.remove();
      kids[3]?.remove();
    }
    $("pre[data-selectable-agent-response]", pane).setAttribute("data-snap-prompt", "");
    const reply = $("[data-assistant-message] .agent-markdown-block", pane);
    reply.innerHTML = "<p data-snap-reply></p>";
    $$(".agent-markdown-block", pane).filter((b) => b !== reply).forEach((b) => b.remove());
    const fold = $(".transcript-live-fold-title", pane);
    if (fold) {
      fold.textContent = T.running;
      const img = fold.closest("button")?.querySelector("img");
      if (img) img.src = codexUri;
    }
    dressComposer(pane);
    liftComposer(pane);
    emptyPane.after(pane);
  }

  /* The real model picker joins the DOM while its CSS is pruned. */
  const pickerPortal = parse(JSON.parse(await get("picker" + suffix + ".json")).portal);
  document.body.append(pickerPortal);

  /* Prune CSS: keep rules whose selectors match this DOM in either theme. */
  const dark = [...html.attributes].map((a) => [a.name, a.value]);
  const light = dark.filter(([n]) => n !== "class" && n !== "data-skin" && n !== "style").concat([["class", "theme-light"], ["data-skin", "daylight"], ["style", "color-scheme: light;"]]);
  const setAttrs = (attrs) => {
    for (const a of [...html.attributes]) html.removeAttribute(a.name);
    for (const [n, v] of attrs) html.setAttribute(n, v);
  };
  const dynamic = /::?(hover|active|focus|focus-visible|focus-within|visited|before|after|placeholder|selection|backdrop|marker|first-letter|first-line|-webkit-[\w-]+|-moz-[\w-]+|placeholder-shown|autofill|checked|disabled|enabled|empty|target|indeterminate|open|popover-open|user-invalid|invalid|valid|read-only|read-write|default|modal|fullscreen|file-selector-button|scrollbar[\w-]*)(\([^()]*\))?/g;
  const matches = (sel) => {
    try { if (document.querySelector(sel)) return true; } catch {}
    const stripped = sel.replace(dynamic, "").trim();
    if (!stripped) return true;
    try { return !!document.querySelector(stripped); } catch { return true; }
  };
  const keep = new Set();
  const walk = (rules, path) => {
    [...rules].forEach((rule, i) => {
      const p = path + "." + i;
      if (rule instanceof CSSStyleRule) { if (matches(rule.selectorText)) keep.add(p); }
      else if (rule instanceof CSSKeyframesRule || !rule.cssRules) keep.add(p);
      else walk(rule.cssRules, p);
    });
  };
  const sheets = [...document.styleSheets];
  for (const attrs of [dark, light]) {
    setAttrs(attrs);
    sheets.forEach((sheet, i) => { try { walk(sheet.cssRules, String(i)); } catch {} });
  }
  setAttrs(dark);
  const emit = (rules, path) => {
    let out = "";
    [...rules].forEach((rule, i) => {
      const p = path + "." + i;
      if (rule instanceof CSSStyleRule || rule instanceof CSSKeyframesRule || !rule.cssRules) {
        if (keep.has(p)) out += rule.cssText + "\n";
      } else {
        const inner = emit(rule.cssRules, p);
        if (inner) out += rule.cssText.slice(0, rule.cssText.indexOf("{")).trim() + " {\n" + inner + "}\n";
      }
    });
    return out;
  };
  let css = "";
  sheets.forEach((sheet, i) => { try { css += emit(sheet.cssRules, String(i)); } catch {} });

  pickerPortal.remove();
  await post("snap" + suffix + ".json", JSON.stringify({ dark, light, body: $("#root").innerHTML, css }));
  return { cssKb: Math.round(css.length / 1024), bodyKb: Math.round($("#root").innerHTML.length / 1024) };
})();
