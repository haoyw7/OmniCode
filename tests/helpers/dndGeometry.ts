import { vi } from "vitest";

/** happy-dom does not lay out dnd-kit's fixed overlay from its inline box. */
export function mockDragOverlayGeometry() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const overlay = this.closest<HTMLElement>(".sortable-overlay");
    if (!overlay) return original.call(this);
    return new DOMRect(parseFloat(overlay.style.left) || 0, parseFloat(overlay.style.top) || 0,
      parseFloat(overlay.style.width) || 0, parseFloat(overlay.style.height) || 0);
  });
}
