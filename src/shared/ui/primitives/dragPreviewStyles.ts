// Preview DOM lives in a shadow root: app queries, IDs and form names cannot
// reach it, while its existing selectors can keep styling a complete copy.
export const interactionStates = ["hover", "active", "focus-visible", "focus-within", "focus"] as const;

type SheetEntry = { source: CSSStyleSheet; count: number; copy: CSSStyleSheet };
type Cache = { sheets: CSSStyleSheet[]; entries: SheetEntry[]; users: number; stop?: () => void };
const caches = new WeakMap<Document, Cache>();

function rewriteSelectors(rules: CSSRuleList) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const selector = rule.selectorText.replace(/(?<!\\):root\b/g, "html")
        .replace(/(?<!\\):(hover|active|focus-visible|focus-within|focus)(?![\w-])/g, "[data-preview-$1]");
      if (selector !== rule.selectorText) rule.selectorText = selector;
    }
    if ("cssRules" in rule) rewriteSelectors((rule as CSSGroupingRule).cssRules);
  }
}

function refresh(document: Document, cache: Cache, dirty = new Set<CSSStyleSheet>()) {
  const sheets: CSSStyleSheet[] = [];
  const previous = new Map(cache.entries.map(entry => [entry.source, entry]));
  const entries: SheetEntry[] = [];
  for (const original of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    const entry = previous.get(original);
    if (!dirty.has(original) && entry?.count === original.cssRules.length &&
      entry.copy.disabled === original.disabled && entry.copy.media.mediaText === original.media.mediaText) {
      sheets.push(entry.copy);
      entries.push(entry);
      continue;
    }
    const sheet = new CSSStyleSheet({ baseURL: original.href ?? document.baseURI, media: original.media.mediaText, disabled: original.disabled });
    sheet.replaceSync([...original.cssRules].map(rule => rule.cssText).join("\n"));
    rewriteSelectors(sheet.cssRules);
    sheets.push(sheet);
    entries.push({ source: original, count: original.cssRules.length, copy: sheet });
  }
  const reset = new CSSStyleSheet();
  // Context wrappers preserve selectors and inherited values, not artwork.
  // display:contents alone still paints their ::before/::after pseudo-elements.
  reset.replaceSync("* { animation:none!important; transition:none!important; pointer-events:none!important; } [data-preview-ancestor] { display:contents!important; } [data-preview-ancestor]::before, [data-preview-ancestor]::after { content:none!important; display:none!important; }");
  cache.sheets = [...sheets, reset];
  cache.entries = entries;
}

function getCache(document: Document) {
  let cache = caches.get(document);
  if (!cache) {
    cache = { sheets: [], entries: [], users: 0 };
    refresh(document, cache);
    caches.set(document, cache);
  }
  return cache;
}

export function previewStyleSheets(document: Document) {
  const cache = getCache(document);
  // CodeMirror can insert rules through CSSOM without a DOM mutation. Checking
  // sheet counts is cheap and only new rules need parsing, not every drag node.
  if (cache.entries.length !== document.styleSheets.length + document.adoptedStyleSheets.length ||
    cache.entries.some(entry => entry.count !== entry.source.cssRules.length)) refresh(document, cache);
  return cache.sheets;
}

/** Prepare CSS once at provider mount, then only when actual styles change. */
export function observeDragPreviewStyles(document: Document) {
  const cache = getCache(document);
  cache.users++;
  if (!cache.stop) {
    const observer = new MutationObserver(records => {
      const dirty = new Set<CSSStyleSheet>();
      let changed = false;
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target instanceof HTMLStyleElement || target instanceof HTMLLinkElement) {
          if (target.sheet) dirty.add(target.sheet);
          changed = true;
        } else if (!changed) changed = [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches("style, link[rel=stylesheet]") ||
            node.childElementCount > 0 && !!node.querySelector("style, link[rel=stylesheet]")));
      }
      if (changed) refresh(document, cache, dirty);
    });
    // xterm owns styles under its body subtree; ignore ordinary text/attribute
    // updates and recompile only the stylesheet whose content actually changed.
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href", "media", "disabled", "rel"] });
    const loaded = (event: Event) => {
      if (event.target instanceof HTMLLinkElement && event.target.rel === "stylesheet")
        refresh(document, cache, new Set(event.target.sheet ? [event.target.sheet] : []));
    };
    document.addEventListener("load", loaded, true);
    cache.stop = () => { observer.disconnect(); document.removeEventListener("load", loaded, true); };
  }
  return () => {
    if (--cache.users === 0) { cache.stop?.(); caches.delete(document); }
  };
}
