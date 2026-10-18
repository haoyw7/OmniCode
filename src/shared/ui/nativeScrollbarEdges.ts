const attributes = [
  "data-scrollbar-start-x",
  "data-scrollbar-end-x",
  "data-scrollbar-start-y",
  "data-scrollbar-end-y",
] as const;

function updateEdges(el: HTMLElement) {
  // Read all geometry before changing attributes; only edge crossings write styles.
  const states = [
    el.scrollLeft <= 0,
    el.scrollLeft >= el.scrollWidth - el.clientWidth - 0.5,
    el.scrollTop <= 0,
    el.scrollTop >= el.scrollHeight - el.clientHeight - 0.5,
  ];
  attributes.forEach((attribute, index) => {
    const value = String(states[index]);
    if (el.getAttribute(attribute) !== value) el.setAttribute(attribute, value);
  });
}

/** Native scrollbar pseudo-elements have no selector for reaching an endpoint.
 * Discover scrollports on interaction, without scanning the page or observing text
 * tokens. Direct content boxes keep an already visited edge correct after resize.
 * Unvisited native scrollports start at zero, matching the CSS start-state default.
 */
export function observeNativeScrollbarEdges(root: Document | ShadowRoot) {
  const tracked = new Map<HTMLElement, Set<Element>>();
  const owners = new Map<Element, Set<HTMLElement>>();
  const resize = new ResizeObserver((entries) => {
    const changed = new Set<HTMLElement>();
    for (const entry of entries) {
      for (const owner of owners.get(entry.target) ?? []) changed.add(owner);
    }
    for (const el of changed) if (el.isConnected) updateEdges(el);
  });
  const unobserve = (el: HTMLElement) => {
    for (const target of tracked.get(el) ?? []) {
      const targetOwners = owners.get(target);
      targetOwners?.delete(el);
      if (!targetOwners?.size) {
        owners.delete(target);
        resize.unobserve(target);
      }
    }
    tracked.delete(el);
  };
  const observe = (el: HTMLElement) => {
    unobserve(el);
    const targets = new Set<Element>([el, ...el.children]);
    tracked.set(el, targets);
    for (const target of targets) {
      const targetOwners = owners.get(target) ?? new Set<HTMLElement>();
      targetOwners.add(el);
      owners.set(target, targetOwners);
      resize.observe(target);
    }
  };
  const track = (el: HTMLElement) => {
    if (!tracked.has(el)) observe(el);
    updateEdges(el);
  };
  const onScroll = (event: Event) => {
    if (event.target instanceof HTMLElement) track(event.target);
  };
  const onInteraction = (event: Event) => {
    let el = event.target instanceof Element ? event.target : null;
    while (el) {
      if (
        el instanceof HTMLElement &&
        (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
      )
        track(el);
      el = el.parentElement;
    }
  };
  const mutations = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      if (record.target instanceof HTMLElement && tracked.has(record.target)) {
        observe(record.target);
        updateEdges(record.target);
      }
      removed ||= record.removedNodes.length > 0;
    }
    if (removed)
      for (const el of tracked.keys()) {
        if (!el.isConnected) {
          unobserve(el);
          for (const attribute of attributes) el.removeAttribute(attribute);
        }
      }
  });
  mutations.observe(root, { childList: true, subtree: true });
  root.addEventListener("scroll", onScroll, true);
  root.addEventListener("pointerdown", onInteraction, true);
  root.addEventListener("focusin", onInteraction, true);
  return () => {
    mutations.disconnect();
    resize.disconnect();
    root.removeEventListener("scroll", onScroll, true);
    root.removeEventListener("pointerdown", onInteraction, true);
    root.removeEventListener("focusin", onInteraction, true);
    for (const el of tracked.keys())
      for (const attribute of attributes) el.removeAttribute(attribute);
    tracked.clear();
    owners.clear();
  };
}
