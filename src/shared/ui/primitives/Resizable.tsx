import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore,
  type CSSProperties, type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Group, Panel, Separator,
  type GroupImperativeHandle, type PanelImperativeHandle, type GroupProps, type PanelProps, type SeparatorProps,
} from "react-resizable-panels";
import { cn } from "../../lib/cn";
import { beginResizeInteraction } from "../../lib/resizeInteraction";
import { useSurfaceVisibility } from "../SurfaceVisibility";

export type { GroupImperativeHandle, PanelImperativeHandle, Layout } from "react-resizable-panels";

const ResizeContext = createContext<(event: ReactPointerEvent<HTMLDivElement>) => void>(() => {});

export function ResizablePanelGroup({ className, groupRef, elementRef, disabled, orientation = "horizontal", onLayoutChanged, onResizeStart, onResizeEnd, children, ...props }: GroupProps & {
  onResizeStart?: () => void;
  onResizeEnd?: (committed: boolean) => void;
}) {
  const api = useRef<GroupImperativeHandle | null>(null);
  const element = useRef<HTMLDivElement | null>(null);
  const finish = useRef<((commit: boolean) => void) | undefined>(undefined);
  const suppressCommit = useRef(false);
  const changed = useRef(onLayoutChanged);
  changed.current = onLayoutChanged;
  const ended = useRef(onResizeEnd);
  ended.current = onResizeEnd;
  const requested = useRef<Record<string, number> | undefined>(undefined);
  const visible = useSurfaceVisibility();
  const attachApi = useCallback((value: GroupImperativeHandle | null) => {
    api.current = value;
    if (typeof groupRef === "function") groupRef(value);
    else if (groupRef) groupRef.current = value;
  }, [groupRef]);
  const attachElement = useCallback((value: HTMLDivElement | null) => {
    element.current = value;
    if (typeof elementRef === "function") elementRef(value);
    else if (elementRef) elementRef.current = value;
  }, [elementRef]);

  useEffect(() => () => finish.current?.(false), []);
  useEffect(() => {
    if (disabled || !visible) finish.current?.(false);
  }, [disabled, visible]);

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !visible || finish.current || !api.current || !element.current) return;
    // v4 measures and accepts the gesture in its document capture listener.
    if (!event.nativeEvent.defaultPrevented) return;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const pointerType = event.pointerType;
    const group = element.current;
    const controller = api.current;
    const initial = { ...controller.getLayout() };
    requested.current = undefined;
    const transitionNodes = [group, ...group.querySelectorAll<HTMLElement>(":scope > [data-panel]")];
    const transitions = transitionNodes.map(node => node.style.transitionProperty);
    onResizeStart?.();
    const document = handle.ownerDocument;
    const window = document.defaultView!;
    try { handle.setPointerCapture?.(pointerId); } catch { /* Document listeners still own cancellation. */ }
    for (const node of transitionNodes) node.style.transitionProperty = "none";
    group.dataset.resizing = "true";
    const endInteraction = beginResizeInteraction(orientation === "horizontal" ? "col-resize" : "row-resize");
    let released = false;
    const stop = (commit: boolean) => {
      if (finish.current !== stop) return;
      finish.current = undefined;
      document.removeEventListener("pointerup", up);
      window.removeEventListener("pointerup", releasing, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("lostpointercapture", lost, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", abort, true);
      window.removeEventListener("pagehide", abort, true);
      try {
        if (!commit) {
          suppressCommit.current = true;
          document.dispatchEvent(new PointerEvent("pointercancel", { pointerId, pointerType }));
          if (group.isConnected) controller.setLayout(initial);
        } else {
          const layout = controller.getLayout();
          if (Object.keys(initial).some(id => initial[id] !== layout[id])) {
            changed.current?.(layout, { isUserInteraction: true, requestedLayout: requested.current ?? layout });
          }
        }
      } finally {
        try { if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* The pointer may already have been released. */ }
        delete group.dataset.resizing;
        transitionNodes.forEach((node, index) => { node.style.transitionProperty = transitions[index]; });
        try { ended.current?.(commit); }
        finally { endInteraction(); suppressCommit.current = false; }
      }
    };
    const releasing = (next: PointerEvent) => { if (next.pointerId === pointerId) released = true; };
    const up = (next: PointerEvent) => { if (next.pointerId === pointerId) stop(true); };
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) stop(false); };
    const lost = (next: PointerEvent) => { if (next.target === handle && next.pointerId === pointerId) stop(released); };
    const abort = (next: Event) => { if (next.target === window) stop(false); };
    const key = (next: KeyboardEvent) => {
      if (next.key !== "Escape") return;
      next.preventDefault();
      next.stopPropagation();
      stop(false);
    };
    finish.current = stop;
    document.addEventListener("pointerup", up);
    window.addEventListener("pointerup", releasing, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("lostpointercapture", lost, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", abort, true);
    window.addEventListener("pagehide", abort, true);
  };

  return <Group {...props} data-ui="resizable-group" className={cn("min-h-0 min-w-0", className)}
    orientation={orientation} disabled={disabled || !visible} disableCursor resizePreviewMode="panel"
    resizeTargetMinimumSize={{ fine: 10, coarse: 24 }} groupRef={attachApi} elementRef={attachElement}
    onLayoutChanged={(layout, meta) => {
      if (suppressCommit.current) return;
      if (finish.current) requested.current = meta.requestedLayout ?? layout;
      else onLayoutChanged?.(layout, meta);
    }}>
    <ResizeContext.Provider value={begin}>{children}</ResizeContext.Provider>
  </Group>;
}

const subscribeWindowSize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};

export function ResizablePanel({ maxSize, className, style, ...props }: Omit<PanelProps, "maxSize"> & {
  maxSize?: PanelProps["maxSize"] | (() => number);
}) {
  const snapshot = () => typeof maxSize === "function" ? maxSize() : maxSize;
  const maximum = useSyncExternalStore(subscribeWindowSize, snapshot, () => typeof maxSize === "function" ? undefined : maxSize);
  return <Panel {...props} data-ui="resizable-panel" maxSize={maximum}
    className={cn("flex min-h-0 min-w-0 flex-col", className)} style={{ overflow: "visible", ...style }} />;
}

export function ResizableHandle({ className, disabled, onPointerDown, ...props }: SeparatorProps) {
  const begin = useContext(ResizeContext);
  const visible = useSurfaceVisibility();
  return <Separator {...props} data-ui="resizable-handle" data-tauri-drag-region="false" disabled={disabled || !visible} disableDoubleClick
    onPointerDown={(event) => { begin(event); onPointerDown?.(event); }}
    className={cn("relative z-10 flex w-px shrink-0 items-center justify-center bg-border hover:bg-accent focus-visible:outline-2 focus-visible:outline-accent active:bg-accent data-[separator=active]:bg-accent after:absolute after:inset-y-0 after:left-1/2 after:w-2.5 after:-translate-x-1/2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-2.5 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2", className)} />;
}

/** A v4 sizing track for an existing flat/grid layout. The transparent tracks
 * contain no content: resizing never reparents the editor, transcript or PTY.
 * Only the separator receives input. The measured span is independent of the
 * resized element, so writing its width cannot feed back into drag geometry. */
export function ResizableRegion({ targetRef, property = "width", edge = "right", size, min, max, defaultSize, disabled,
  label, className, offset, onPreview, onCommit, onCancel, onActiveChange,
}: {
  targetRef?: RefObject<HTMLElement | null>;
  property?: string;
  edge?: "left" | "right" | "top" | "bottom";
  size: number;
  min: number;
  max: number | (() => number);
  defaultSize: number;
  disabled?: boolean;
  label: string;
  className?: string;
  offset?: string;
  onPreview?: (size: number) => void;
  onCommit: (size: number) => void;
  onCancel?: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const id = useId();
  const sizeId = `${id}:size`, restId = `${id}:rest`;
  const readMax = () => Math.max(min, typeof max === "function" ? typeof window === "undefined" ? size : max() : max);
  const observesLayout = typeof max === "function";
  const subscribeBounds = useCallback((listener: () => void) => {
    const unsubscribe = subscribeWindowSize(listener);
    const node = targetRef?.current;
    const observer = observesLayout && node ? new ResizeObserver(listener) : undefined;
    if (node) observer?.observe(node);
    return () => { unsubscribe(); observer?.disconnect(); };
  }, [targetRef, observesLayout]);
  const maximum = useSyncExternalStore(subscribeBounds, readMax, readMax);
  const panel = useRef<PanelImperativeHandle | null>(null);
  const active = useRef(false);
  const draft = useRef(size);
  const initial = useRef(size);
  const transition = useRef("");
  const synchronized = useRef<{
    controller: PanelImperativeHandle; size: number; min: number; maximum: number; edge: string;
  } | undefined>(undefined);
  const latest = useRef({ onCommit, onPreview, onCancel, onActiveChange, size });
  latest.current = { onCommit, onPreview, onCancel, onActiveChange, size };
  const paint = (next: number) => {
    const value = Math.round(next);
    if (value === draft.current) return;
    draft.current = value;
    targetRef?.current?.style.setProperty(property, `${value}px`);
    latest.current.onPreview?.(value);
  };
  useLayoutEffect(() => {
    // React may update unrelated props during a gesture; keep the live size.
    if (!active.current) {
      draft.current = Math.max(min, Math.min(maximum, size));
      const controller = panel.current;
      const previous = synchronized.current;
      if (controller && (previous?.controller !== controller || previous.size !== draft.current ||
        previous.min !== min || previous.maximum !== maximum || previous.edge !== edge)) {
        synchronized.current = { controller, size: draft.current, min, maximum, edge };
        controller.resize(draft.current);
      }
    }
    const node = targetRef?.current;
    const value = `${draft.current}px`;
    if (node && node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
  });
  useEffect(() => {
    // Ancestor refs attach after descendant layout effects on the first mount.
    if (!active.current) targetRef?.current?.style.setProperty(property, `${draft.current}px`);
  }, [targetRef, property]);
  const vertical = edge === "top" || edge === "bottom";
  const reverse = edge === "left" || edge === "top";
  const trackStyle: CSSProperties = vertical
    ? { position: "absolute", left: 0, width: "100%", height: maximum * 2 + 1, [reverse ? "bottom" : "top"]: offset ?? 0, pointerEvents: "none", zIndex: 20 }
    : { position: "absolute", top: 0, height: "100%", width: maximum * 2 + 1, [reverse ? "right" : "left"]: offset ?? 0, pointerEvents: "none", zIndex: 20 };
  const sized = <ResizablePanel id={sizeId} panelRef={panel} defaultSize={size} minSize={min} maxSize={maximum}
    onResize={next => { if (active.current) paint(next.inPixels); }} />;
  const rest = <ResizablePanel id={restId} minSize={0} />;
  return <ResizablePanelGroup className={className} style={trackStyle} orientation={vertical ? "vertical" : "horizontal"} disabled={disabled}
    onResizeStart={() => {
      initial.current = draft.current;
      active.current = true;
      const node = targetRef?.current;
      if (node) { transition.current = node.style.transitionProperty; node.style.transitionProperty = "none"; node.dataset.resizing = "true"; }
      latest.current.onActiveChange?.(true);
    }}
    onResizeEnd={committed => {
      if (!committed) { paint(initial.current); latest.current.onCancel?.(); }
      active.current = false;
      const node = targetRef?.current;
      if (node) { node.style.transitionProperty = transition.current; delete node.dataset.resizing; }
      latest.current.onActiveChange?.(false);
    }}
    onLayoutChanged={(layout, meta) => {
      if (!meta.isUserInteraction || !panel.current) return;
      // getSize().inPixels reads offsetWidth before the keyboard layout has
      // painted. The sizing track has an explicit, stable pixel span.
      const next = Math.round(layout[sizeId] * maximum * 2 / 100);
      paint(next);
      latest.current.onCommit(next);
    }}>
    {reverse ? rest : sized}
    <ResizableHandle aria-label={label} className="pointer-events-auto !h-full !w-px aria-[orientation=horizontal]:!h-px aria-[orientation=horizontal]:!w-full"
      onDoubleClick={() => {
        const next = Math.max(min, Math.min(maximum, defaultSize));
        panel.current?.resize(next); paint(next); latest.current.onCommit(next);
      }} />
    {reverse ? sized : rest}
  </ResizablePanelGroup>;
}
