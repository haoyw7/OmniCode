export type ScrollbarMetrics = {
  scrollable: boolean;
  maxScroll: number;
  maxThumbTop: number;
  thumbHeight: number;
  thumbTop: number;
};

/** trackHeight excludes the two arrow buttons. */
export function scrollbarMetrics(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
): ScrollbarMetrics {
  const viewport = Math.max(0, clientHeight);
  const content = Math.max(viewport, scrollHeight);
  const track = Math.max(0, trackHeight);
  const maxScroll = Math.max(0, content - viewport);
  if (track === 0 || maxScroll === 0) {
    return {
      scrollable: false,
      maxScroll,
      maxThumbTop: 0,
      thumbHeight: track,
      thumbTop: 0,
    };
  }
  const thumbHeight = Math.min(
    track,
    Math.max(32, (track * viewport) / content),
  );
  const maxThumbTop = track - thumbHeight;
  return {
    scrollable: true,
    maxScroll,
    maxThumbTop,
    thumbHeight,
    thumbTop: Math.min(1, Math.max(0, scrollTop / maxScroll)) * maxThumbTop,
  };
}

type ScrollPosition = { offset: number; content: number; viewport: number };

/** Imperative adapter for editors/terminals that cannot use a native rail.
 * The owner supplies scroll units (pixels or terminal rows), never business state.
 * Keyboard scrolling remains on the owner's focusable viewport.
 */
export class Scrollbar {
  readonly dom = document.createElement("div");
  readonly thumb = document.createElement("div");
  private readonly observer: ResizeObserver | undefined;
  private readonly win: Window;
  private height = 0;
  private arrowSize = 7;
  private drag: { pointerId: number; top: number; offset: number } | undefined;
  private lastHeight = -1;
  private lastTop = -1;

  constructor(
    parent: HTMLElement,
    private readonly read: () => ScrollPosition,
    private readonly scrollTo: (offset: number) => void,
    private readonly step: () => number,
    private readonly orientation: "vertical" | "horizontal" = "vertical",
  ) {
    this.win = parent.ownerDocument.defaultView ?? window;
    this.dom.dataset.ui = "scrollbar";
    this.dom.dataset.orientation = orientation;
    this.dom.setAttribute("aria-hidden", "true");
    this.thumb.dataset.ui = "scrollbar-thumb";
    this.dom.append(this.thumb);
    for (const direction of ["start", "end"]) {
      const arrow = document.createElement("div");
      arrow.dataset.ui = "scrollbar-arrow";
      arrow.dataset.direction = direction;
      this.dom.append(arrow);
    }
    parent.append(this.dom);
    const startArrow = this.dom.querySelector<HTMLElement>('[data-direction="start"]')!;
    this.dom.addEventListener("pointerdown", this.onDown);
    this.dom.addEventListener("pointermove", this.onMove);
    this.dom.addEventListener("pointerup", this.onUp);
    this.dom.addEventListener("pointercancel", this.onUp);
    this.dom.addEventListener("lostpointercapture", this.stopDrag);
    this.win.addEventListener("blur", this.stopDrag);
    this.win.addEventListener("keydown", this.onKey);
    this.height =
      orientation === "vertical" ? this.dom.clientHeight : this.dom.clientWidth;
    this.arrowSize =
      (orientation === "vertical"
        ? startArrow.clientHeight
        : startArrow.clientWidth) || (orientation === "vertical" ? 9 : 7);
    this.observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              const length = orientation === "vertical"
                ? entry.contentRect.height
                : entry.contentRect.width;
              if (entry.target === startArrow) this.arrowSize = length;
              else this.height = length;
            }
            this.update();
          });
    this.observer?.observe(this.dom);
    this.observer?.observe(startArrow);
    this.update();
  }

  private metrics() {
    const { offset, content, viewport } = this.read();
    return scrollbarMetrics(
      offset,
      content,
      viewport,
      this.height - 2 * this.arrowSize,
    );
  }

  readonly update = () => {
    const metrics = this.metrics();
    const position = this.read();
    for (const [edge, reached] of [
      ["start", position.offset <= 0],
      ["end", position.offset >= metrics.maxScroll - 0.5],
    ] as const) {
      const attribute = `data-scrollbar-${edge}`;
      const value = String(reached);
      if (this.dom.getAttribute(attribute) !== value)
        this.dom.setAttribute(attribute, value);
    }
    const overflowing = String(metrics.scrollable);
    if (this.dom.dataset.overflow !== overflowing)
      this.dom.dataset.overflow = overflowing;
    if (!metrics.scrollable) {
      this.stopDrag();
      return;
    }
    if (metrics.thumbHeight !== this.lastHeight) {
      this.thumb.style[this.orientation === "vertical" ? "height" : "width"] =
        `${metrics.thumbHeight}px`;
      this.lastHeight = metrics.thumbHeight;
    }
    if (metrics.thumbTop !== this.lastTop) {
      this.thumb.style.transform = `translate${this.orientation === "vertical" ? "Y" : "X"}(${metrics.thumbTop}px)`;
      this.lastTop = metrics.thumbTop;
    }
  };

  private readonly onDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.drag) return;
    const metrics = this.metrics();
    if (!metrics.scrollable) return;
    // Read before capture/interaction styles; moves reuse this origin.
    const rect = this.dom.getBoundingClientRect();
    const top =
      (this.orientation === "vertical" ? rect.top : rect.left) + this.arrowSize;
    const coordinate =
      this.orientation === "vertical" ? event.clientY : event.clientX;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const direction = target.dataset.direction;
    const position = this.read();
    if (direction) {
      this.scrollTo(
        Math.max(
          0,
          Math.min(
            metrics.maxScroll,
            position.offset + (direction === "start" ? -1 : 1) * this.step(),
          ),
        ),
      );
    } else if (target === this.thumb) {
      this.drag = {
        pointerId: event.pointerId,
        top,
        offset: coordinate - top - metrics.thumbTop,
      };
      this.dom.setPointerCapture?.(event.pointerId);
      this.dom.dataset.dragging = "true";
    } else {
      const direction = coordinate - top < metrics.thumbTop ? -1 : 1;
      this.scrollTo(
        Math.max(
          0,
          Math.min(
            metrics.maxScroll,
            position.offset + direction * position.viewport,
          ),
        ),
      );
    }
    this.update();
  };

  private readonly onMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const metrics = this.metrics();
    if (!metrics.maxThumbTop) return;
    event.preventDefault();
    const coordinate =
      this.orientation === "vertical" ? event.clientY : event.clientX;
    const top = Math.max(
      0,
      Math.min(metrics.maxThumbTop, coordinate - drag.top - drag.offset),
    );
    this.scrollTo((top / metrics.maxThumbTop) * metrics.maxScroll);
    this.update();
  };

  private readonly onUp = (event: PointerEvent) => {
    if (event.pointerId === this.drag?.pointerId) this.stopDrag();
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.drag) {
      event.preventDefault();
      this.stopDrag();
    }
  };

  private readonly stopDrag = () => {
    const drag = this.drag;
    this.drag = undefined;
    delete this.dom.dataset.dragging;
    if (drag && this.dom.hasPointerCapture?.(drag.pointerId)) {
      this.dom.releasePointerCapture(drag.pointerId);
    }
  };

  destroy() {
    this.stopDrag();
    this.observer?.disconnect();
    this.win.removeEventListener("blur", this.stopDrag);
    this.win.removeEventListener("keydown", this.onKey);
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointercancel", this.onUp);
    this.dom.removeEventListener("lostpointercapture", this.stopDrag);
    this.dom.remove();
  }
}
