import { useLayoutEffect, useRef } from "react";
import { interactionStates, previewStyleSheets } from "./dragPreviewStyles";

export type DragPreviewSnapshot = {
  element: HTMLElement;
  rect: { top: number; left: number; width: number; height: number };
  mount: (host: HTMLElement) => () => void;
};

type CapturedTree = {
  originals: Element[];
  offsets: { top: number; left: number }[];
  states: { state: typeof interactionStates[number]; nodes: Element[] }[];
  shadows: { index: number; root: ShadowRoot; tree: CapturedTree }[];
};

function readTree(root: HTMLElement | ShadowRoot): CapturedTree {
  const originals = [...(root instanceof HTMLElement ? [root] : []), ...root.querySelectorAll("*")];
  return {
    originals,
    offsets: originals.map(node => ({ top: node.scrollTop, left: node.scrollLeft })),
    states: interactionStates.map(state => ({ state, nodes: [
      ...(root instanceof HTMLElement && root.matches(`:${state}`) ? [root] : []), ...root.querySelectorAll(`:${state}`),
    ] })),
    shadows: originals.flatMap((node, index): CapturedTree["shadows"] =>
      node.shadowRoot ? [{ index, root: node.shadowRoot, tree: readTree(node.shadowRoot) }] : []),
  };
}

// Read only geometry and scroll offsets. Reuse prepared CSS instead of resolving
// and serializing every declaration on every text/token node at pickup.
export function captureDragPreview(source: HTMLElement): DragPreviewSnapshot {
  const document = source.ownerDocument;
  const { top, left, width, height } = source.getBoundingClientRect();
  const rect = { top, left, width, height };
  const sheets = previewStyleSheets(document);
  const tree = readTree(source);
  const ancestors: HTMLElement[] = [];
  for (let node = source.parentElement; node; node = node.parentElement) ancestors.push(node);
  const ancestorStates = ancestors.map(node => interactionStates.filter(state => node.matches(`:${state}`)));

  // Keep data/style attributes and IDs inside the isolated tree so selectors
  // and SVG references work without a second React/editor/terminal instance.
  const element = source.cloneNode(true) as HTMLElement;
  const scroll: { element: Element; top: number; left: number }[] = [];
  const copyState = (root: HTMLElement | ShadowRoot, { originals, offsets, states, shadows }: CapturedTree) => {
    const copies = [...(root instanceof HTMLElement ? [root] : []), ...root.querySelectorAll("*")];
    copies.forEach((copy, index) => {
      const original = originals[index];
      for (const name of copy.getAttributeNames()) {
        if (name === "autofocus" || name.startsWith("on")) copy.removeAttribute(name);
      }
      if (offsets[index].top || offsets[index].left) scroll.push({ element: copy, ...offsets[index] });
      switch (original.tagName) {
        case "INPUT": {
          const input = original as HTMLInputElement, target = copy as HTMLInputElement;
          if (input.type !== "file") target.value = input.value;
          target.checked = input.checked;
          break;
        }
        case "TEXTAREA": (copy as HTMLTextAreaElement).value = (original as HTMLTextAreaElement).value; break;
        case "SELECT": (copy as HTMLSelectElement).selectedIndex = (original as HTMLSelectElement).selectedIndex; break;
        case "CANVAS": {
          const canvas = original as HTMLCanvasElement;
          if (canvas.width && canvas.height) (copy as HTMLCanvasElement).getContext("2d")?.drawImage(canvas, 0, 0);
        }
      }
    });
    for (const { state, nodes } of states) for (const node of nodes) copies[originals.indexOf(node)].setAttribute(`data-preview-${state}`, "");
    for (const captured of shadows) {
      const target = copies[captured.index];
      const shadow = target.shadowRoot ?? target.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [...captured.root.adoptedStyleSheets, sheets[sheets.length - 1]];
      shadow.replaceChildren(...[...captured.root.childNodes].map(node => node.cloneNode(true)));
      copyState(shadow, captured.tree);
      shadow.querySelectorAll("script, link").forEach(node => node.remove());
    }
  };
  copyState(element, tree);
  element.querySelectorAll("script, style, link").forEach(node => node.remove());
  element.setAttribute("data-drag-preview-content", "");
  Object.assign(element.style, {
    position: "relative", top: "0px", left: "0px", right: "auto", bottom: "auto", margin: "0px",
    boxSizing: "border-box", width: `${width}px`, height: `${height}px`,
    minWidth: `${width}px`, maxWidth: `${width}px`, minHeight: `${height}px`, maxHeight: `${height}px`,
    transform: "none", translate: "none", rotate: "none", scale: "none", gridArea: "auto", flex: "none",
  });
  let context: Element = element;
  ancestors.forEach((ancestor, index) => {
    const wrapper = ancestor.cloneNode(false) as HTMLElement;
    wrapper.setAttribute("data-preview-ancestor", "");
    for (const state of ancestorStates[index]) wrapper.setAttribute(`data-preview-${state}`, "");
    wrapper.append(context);
    context = wrapper;
  });
  return { element, rect, mount(host) {
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = sheets;
    shadow.replaceChildren(context);
    for (const { element, top, left } of scroll) { element.scrollTop = top; element.scrollLeft = left; }
    return () => { context.remove(); shadow.adoptedStyleSheets = []; };
  } };
}

export function DragPreview({ snapshot }: { snapshot: DragPreviewSnapshot }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => host.current ? snapshot.mount(host.current) : undefined, [snapshot]);
  return <div ref={host} data-drag-preview inert aria-hidden className="pointer-events-none"
    style={{ width: snapshot.rect.width, height: snapshot.rect.height }} />;
}
