import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  closestCenter, pointerWithin, DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors, type DraggableAttributes, type CollisionDetection,
  type KeyboardCoordinateGetter, type Active, type DroppableContainer,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "../../i18n/useTranslation";
import { LAYER } from "../../lib/layers";
import { useMotionPreference } from "../../motion/useMotionPreference";
import { ListMotion, useListMotion } from "../ListMotion";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../SurfaceVisibility";
import { captureDragPreview, DragPreview, type DragPreviewSnapshot } from "./DragPreview";
import { observeDragPreviewStyles } from "./dragPreviewStyles";

export type DragPayload = { type: string; [key: string]: unknown };
type ListController = {
  id: string;
  ids: string[];
  nodes: Map<string, HTMLElement>;
  disabled: boolean;
  touch: boolean;
  onReorder: (ids: string[], moved: string) => void;
  renderOverlay: (id: string) => ReactNode;
  onActiveChange?: (active: boolean) => void;
  overlayContainer?: HTMLElement | null;
  overlayClassName?: string;
};
type Source = {
  id: string;
  payload: DragPayload;
  list?: RefObject<ListController>;
  renderOverlay?: () => ReactNode;
  onActiveChange?: (active: boolean) => void;
  previewElement?: () => HTMLElement | null;
};
type Target = { accepts: (payload: DragPayload) => boolean; onDrop: (payload: DragPayload) => void };
type DragData = { source?: Source; target?: Target };
const dataOf = (value: { data: { current?: Record<string, unknown> } }): DragData => value.data.current ?? {};
function eligible(active: Active, container: DroppableContainer) {
  if (container.disabled) return false;
  const source = dataOf(active).source;
  const target = dataOf(container);
  if (!source) return false;
  if (target.target?.accepts(source.payload)) return true;
  return !!source.list && target.source?.list === source.list;
}

const collisionDetection: CollisionDetection = args => {
  const containers = args.droppableContainers.filter(container => eligible(args.active, container));
  if (args.pointerCoordinates) {
    const external = containers.filter(container => dataOf(container).target);
    const hits = pointerWithin({ ...args, droppableContainers: external });
    if (hits.length) return hits;
    const sortable = containers.filter(container => !dataOf(container).target);
    // A tall card's center may be offscreen even when its header is under the
    // pointer. Keep the active item eligible too, so its original slot remains
    // reachable (including the final slot and a reversal back to the start).
    const inside = pointerWithin({ ...args, droppableContainers: sortable });
    if (inside.length) return inside;
    const { x, y } = args.pointerCoordinates;
    return closestCenter({ ...args, droppableContainers: sortable,
      collisionRect: { left: x, right: x, top: y, bottom: y, width: 0, height: 0 },
    });
  }
  return closestCenter({ ...args, droppableContainers: containers });
};

const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const { active, collisionRect, droppableRects, droppableContainers } = context;
  if (!active || !collisionRect || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) return;
  event.preventDefault();
  const center = { x: collisionRect.left + collisionRect.width / 2, y: collisionRect.top + collisionRect.height / 2 };
  let result: { x: number; y: number } | undefined;
  let distance = Infinity;
  for (const container of droppableContainers.getEnabled()) {
    if (!eligible(active, container)) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const ahead = event.code === "ArrowRight" ? x > center.x + 1 : event.code === "ArrowLeft" ? x < center.x - 1
      : event.code === "ArrowDown" ? y > center.y + 1 : y < center.y - 1;
    const next = Math.hypot(x - center.x, y - center.y);
    if (ahead && next < distance) { distance = next; result = { x: currentCoordinates.x + x - center.x, y: currentCoordinates.y + y - center.y }; }
  }
  return result;
};

class CapturedPointerSensor extends PointerSensor {
  constructor(props: ConstructorParameters<typeof PointerSensor>[0]) {
    const node = props.activeNode.node.current;
    const pointer = props.event as PointerEvent;
    const pointerId = pointer.pointerId;
    const ownerDocument = node?.ownerDocument ?? document;
    const mouse = pointer.pointerType === "mouse";
    let pickupCoordinates: { x: number; y: number } | undefined;
    const rememberPickup = (event: PointerEvent) => {
      if (event.pointerId === pointerId) pickupCoordinates = { x: event.clientX, y: event.clientY };
    };
    const stopRemembering = () => ownerDocument.removeEventListener("pointermove", rememberPickup, true);
    const cancel = () => node?.ownerDocument.dispatchEvent(new Event("pointercancel"));
    const cleanup = () => {
      stopRemembering();
      node?.removeEventListener("lostpointercapture", cancel);
      try { if (node?.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId); } catch { /* The pointer may already have ended. */ }
    };
    super({ ...props,
      options: mouse ? { ...props.options, activationConstraint: { distance: 0 } } : props.options,
      onStart: coordinates => {
        stopRemembering();
        try { node?.setPointerCapture?.(pointerId); } catch { /* The sensor also listens on the document. */ }
        props.onStart(coordinates);
        // The distance sensor consumes the activation move. Forward its position
        // now so a single quick gesture does not wait for a second mouse event.
        if (pickupCoordinates) props.onMove(pickupCoordinates);
      },
      onEnd: () => { cleanup(); props.onEnd(); },
      onCancel: () => { cleanup(); props.onCancel(); },
      onAbort: id => { cleanup(); props.onAbort(id); },
    });
    if (mouse) ownerDocument.addEventListener("pointermove", rememberPickup, true);
    node?.addEventListener("lostpointercapture", cancel);
  }
  static activators: typeof PointerSensor.activators = [{
    eventName: "onPointerDown",
    handler: (event, options, context?: { active: Parameters<typeof dataOf>[0] }) => {
      const source = context && dataOf(context.active).source;
      if (source?.list?.current.touch) return false;
      return PointerSensor.activators[0].handler(event, options);
    },
  }];
}

type DragScope = {
  active: Source | null;
  sizes: ReadonlyMap<string, { width: number; height: number }>;
  cancel: () => void;
  consumeClick: () => boolean;
  resetClick: () => void;
};
const DragScopeContext = createContext<DragScope | null>(null);
const ActiveDragRefContext = createContext<RefObject<DragPayload | null>>({ current: null });
const ListContext = createContext<RefObject<ListController> | null>(null);

export function DragDropProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => observeDragPreviewStyles(document), []);
  const { t } = useTranslation();
  const reduced = useMotionPreference();
  const [active, setActive] = useState<Source | null>(null);
  const sourceRef = useRef<Source | null>(null);
  const activePayload = useRef<DragPayload | null>(null);
  const initialIds = useRef<string[]>([]);
  const sizes = useRef(new Map<string, { width: number; height: number }>());
  const preview = useRef<DragPreviewSnapshot | null>(null);
  const suppressClickUntil = useRef(0);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const cancelDrag = useCallback(() => cancel.current?.(), []);
  const consumeClick = useCallback(() => performance.now() < suppressClickUntil.current, []);
  const resetClick = useCallback(() => { suppressClickUntil.current = 0; }, []);
  const onActivation = useCallback(({ event }: { event: Event }) => {
    const target = event.target instanceof Element ? event.target : document.body;
    cancel.current = () => {
      if (event.type === "touchstart") target.dispatchEvent(new Event("touchcancel", { bubbles: true }));
      else if (event.type === "pointerdown") target.ownerDocument.dispatchEvent(new Event("pointercancel"));
      else target.ownerDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
    };
  }, []);
  useEffect(() => {
    const abort = () => cancel.current?.();
    window.addEventListener("blur", abort);
    return () => { abort(); window.removeEventListener("blur", abort); };
  }, []);
  const options = useMemo(() => ({
    pointer: { activationConstraint: { distance: 5 }, onActivation },
    touch: { activationConstraint: { delay: 400, tolerance: 8 }, onActivation },
    keyboard: { coordinateGetter: keyboardCoordinates, onActivation,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter", "Tab"] } },
  }), [onActivation]);
  const sensors = useSensors(useSensor(CapturedPointerSensor, options.pointer), useSensor(TouchSensor, options.touch), useSensor(KeyboardSensor, options.keyboard));
  const finish = () => {
    cancel.current = undefined;
    suppressClickUntil.current = performance.now() + 400;
    const source = sourceRef.current;
    sourceRef.current = null;
    activePayload.current = null;
    sizes.current = new Map();
    preview.current = null;
    setActive(null);
    source?.list?.current.onActiveChange?.(false);
    source?.onActiveChange?.(false);
  };
  const list = active?.list?.current;
  const scope = useMemo<DragScope>(() => ({ active, sizes: sizes.current, cancel: cancelDrag,
    consumeClick, resetClick }), [active, cancelDrag, consumeClick, resetClick]);
  return <DndContext sensors={sensors} collisionDetection={collisionDetection}
    accessibility={{
      screenReaderInstructions: { draggable: t("Press Space to pick up, arrow keys to move, Space to drop, or Escape to cancel.") },
      announcements: {
        onDragStart: () => t("Item picked up."),
        onDragOver: ({ over }) => {
          const source = over && dataOf(over).source;
          const index = source?.list?.current.ids.indexOf(source.id);
          return index !== undefined && index >= 0 ? t("Moving to position {position}.", { position: index + 1 }) : undefined;
        },
        onDragEnd: () => t("Item dropped."), onDragCancel: () => t("Drag cancelled."),
      },
    }}
    onDragStart={({ active }) => {
      const source = dataOf(active).source;
      if (!source) return;
      sourceRef.current = source;
      activePayload.current = source.payload;
      initialIds.current = source.list?.current.ids.slice() ?? [];
      // Read the whole list before activation changes styles. Keep these border-box
      // sizes until drop/cancel so flex layout and parent renders cannot resize it.
      sizes.current = new Map();
      source.list?.current.nodes.forEach((node, id) => {
        const { width, height } = node.getBoundingClientRect();
        if (width > 0 && height > 0) sizes.current.set(id, { width, height });
      });
      const node = source.previewElement?.() ?? source.list?.current.nodes.get(source.id);
      preview.current = node ? captureDragPreview(node) : null;
      suppressClickUntil.current = 0;
      setActive(source);
      source.list?.current.onActiveChange?.(true);
      source.onActiveChange?.(true);
    }}
    onDragCancel={finish} onDragAbort={() => { cancel.current = undefined; }}
    onDragEnd={({ active, over }) => {
      const source = dataOf(active).source;
      const target = over && dataOf(over);
      finish();
      if (!source || !target) return;
      const list = source.list?.current;
      if (list && (list.disabled || initialIds.current.join("\0") !== list.ids.join("\0"))) return;
      if (target.target?.accepts(source.payload)) { target.target.onDrop(source.payload); return; }
      if (!list || !target.source || target.source.list !== source.list) return;
      const from = list.ids.indexOf(source.id), to = list.ids.indexOf(target.source.id);
      if (from >= 0 && to >= 0 && from !== to) list.onReorder(arrayMove(list.ids, from, to), source.id);
    }}>
    <DragScopeContext.Provider value={scope}>
      <ActiveDragRefContext.Provider value={activePayload}>{children}</ActiveDragRefContext.Provider>
    </DragScopeContext.Provider>
    {createPortal(<DragOverlay adjustScale={false} className="sortable-overlay" zIndex={LAYER.dragLabel}
      style={preview.current?.rect} dropAnimation={reduced ? null : { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
      {active && preview.current ? <DragPreview snapshot={preview.current} /> : active ? <div className={list?.overlayClassName ?? "pointer-events-none max-w-60 truncate rounded-md border border-stroke bg-background-base px-2.5 py-1 text-[13px] text-content shadow-lg"} aria-hidden>
        {active.renderOverlay?.() ?? (list?.ids.includes(active.id) ? list.renderOverlay(active.id) : null)}
      </div> : null}
    </DragOverlay>, list?.overlayContainer ?? document.body)}
  </DndContext>;
}

type SortableListProps<T extends string> = {
  ids: T[]; onReorder: (ids: T[], movedId: T) => void; axis?: "x" | "y"; disabled?: boolean; touch?: boolean;
  renderOverlay: (id: T) => ReactNode; children: ReactNode; onActiveChange?: (active: boolean) => void;
  cancelRef?: RefObject<(() => void) | undefined>; overlayContainer?: HTMLElement | null; overlayClassName?: string;
};
export function SortableList<T extends string>(props: SortableListProps<T>) {
  const scope = useContext(DragScopeContext);
  return scope ? <SortableCollection {...props} /> : <DragDropProvider><SortableCollection {...props} /></DragDropProvider>;
}
function SortableCollection<T extends string>({ ids, onReorder, axis = "y", disabled = false, touch = false, renderOverlay, children, onActiveChange, cancelRef, overlayContainer, overlayClassName }: SortableListProps<T>) {
  const scope = useContext(DragScopeContext)!;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const id = useId();
  const nodes = useRef(new Map<string, HTMLElement>());
  const list = useRef<ListController>(null!);
  list.current = { id, ids, nodes: nodes.current, disabled, touch, onReorder: (next, moved) => onReorder(next as T[], moved as T), renderOverlay: item => renderOverlay(item as T), onActiveChange, overlayContainer, overlayClassName };
  const key = ids.join("\0");
  useEffect(() => {
    if (scopeRef.current.active?.list === list) scopeRef.current.cancel();
  }, [disabled, key]);
  useEffect(() => {
    if (cancelRef) cancelRef.current = () => scopeRef.current.cancel();
    return () => {
      if (scopeRef.current.active?.list === list) scopeRef.current.cancel();
      if (cancelRef) cancelRef.current = undefined;
    };
  }, [cancelRef]);
  return <ListContext.Provider value={list}>
    <SortableContext id={id} items={ids.map(item => `${id}:${item}`)} disabled={disabled}
      strategy={axis === "x" ? horizontalListSortingStrategy : verticalListSortingStrategy}>
      <ListMotion enabled={scope.active?.list !== list}>{children}</ListMotion>
    </SortableContext>
  </ListContext.Provider>;
}

export type SortableItemState = {
  ref: (node: HTMLElement | null) => void; style: CSSProperties;
  handleProps: DraggableAttributes & Pick<HTMLAttributes<HTMLElement>, "onPointerDown" | "onTouchStart" | "onKeyDown" | "onPointerDownCapture" | "onTouchStartCapture"> & { ref: (node: HTMLElement | null) => void };
  dragging: boolean; sorting: boolean; consumeClick: () => boolean; motionProps: ReturnType<typeof useListMotion>;
  setPayload: (payload: DragPayload, renderOverlay?: () => ReactNode) => () => void;
};
export const DragHandleContext = createContext<SortableItemState["handleProps"] | undefined>(undefined);
export const useDragHandle = () => useContext(DragHandleContext);
export function SortableItem({ id, disabled = false, payload, renderOverlay, onActiveChange, children }: {
  id: string; disabled?: boolean; payload?: DragPayload; renderOverlay?: () => ReactNode; onActiveChange?: (active: boolean) => void;
  children: (item: SortableItemState) => ReactNode;
}) {
  const scope = useContext(DragScopeContext)!;
  const list = useContext(ListContext)!;
  const reduced = useMotionPreference();
  const motionProps = useListMotion();
  const visible = useSurfaceVisibility();
  const inactive = disabled || !visible || !!motionProps.inert;
  const latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(() => {
    const cancel = () => { if (latestScope.current.active?.list === list && latestScope.current.active.id === id) latestScope.current.cancel(); };
    if (inactive) cancel();
    return cancel;
  }, [inactive, id, list]);
  const source = useRef<Source>({ id, list, payload: payload ?? { type: "sort", id }, renderOverlay, onActiveChange });
  source.current.list = list;
  source.current.onActiveChange = onActiveChange;
  if (payload) source.current.payload = payload;
  if (renderOverlay) source.current.renderOverlay = renderOverlay;
  const setPayload = useCallback((value: DragPayload, preview?: () => ReactNode) => {
    source.current.payload = value;
    source.current.renderOverlay = preview;
    return () => {
      if (source.current.payload !== value) return;
      source.current.payload = payload ?? { type: "sort", id };
      source.current.renderOverlay = renderOverlay;
    };
  }, [payload, renderOverlay, id]);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `${list.current.id}:${id}`, disabled: inactive, data: { source: source.current },
    transition: reduced ? null : { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  });
  const ref = useCallback((node: HTMLElement | null) => {
    if (node) list.current.nodes.set(id, node);
    else list.current.nodes.delete(id);
    setNodeRef(node);
  }, [id, list, setNodeRef]);
  const size = scope.active?.list === list ? scope.sizes.get(id) : undefined;
  const translate = CSS.Translate.toString(transform);
  const dragTransition = scope.active?.list === list ? transition : undefined;
  const sorting = !!scope.active;
  const item = useMemo<SortableItemState>(() => ({
    ref, style: {
      ...(size ? { boxSizing: "border-box", width: size.width, height: size.height,
        minWidth: size.width, maxWidth: size.width, minHeight: size.height, maxHeight: size.height,
        flex: "0 0 auto" } : {}),
      transform: translate,
      transition: dragTransition,
    },
    handleProps: { ...attributes, ...listeners, ref: setActivatorNodeRef, onPointerDownCapture: scope.resetClick, onTouchStartCapture: scope.resetClick },
    dragging: isDragging, sorting, consumeClick: scope.consumeClick,
    setPayload,
    motionProps: { ...motionProps, animate: { opacity: isDragging ? 0.35 : 1 } },
  }), [ref, size, translate, dragTransition, sorting, scope.resetClick, scope.consumeClick,
    attributes, listeners, setActivatorNodeRef, isDragging, setPayload, motionProps]);
  const content = useMemo(() => children(item), [children, item]);
  return <SurfaceVisibilityContext.Provider value={visible && !motionProps.inert}>{content}</SurfaceVisibilityContext.Provider>;
}

type DraggableProps = {
  payload: DragPayload; renderOverlay: () => ReactNode; disabled?: boolean; onActiveChange?: (active: boolean) => void;
  previewElement?: () => HTMLElement | null;
};
export function useDraggableItem({ payload, renderOverlay, disabled = false, onActiveChange, previewElement }: DraggableProps) {
  const id = useId();
  const node = useRef<HTMLElement | null>(null);
  const scope = useContext(DragScopeContext);
  const visible = useSurfaceVisibility();
  const latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(() => {
    const cancel = () => { if (latestScope.current?.active?.id === id) latestScope.current.cancel(); };
    if (disabled || !visible) cancel();
    return cancel;
  }, [disabled, visible, id]);
  const source: Source = { id, payload, renderOverlay, onActiveChange, previewElement: () => previewElement?.() ?? node.current };
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({ id, data: { source }, disabled: disabled || !scope || !visible });
  const ref = useCallback((element: HTMLElement | null) => { node.current = element; setNodeRef(element); }, [setNodeRef]);
  // Crossing drop targets must not invalidate a pane's chat/editor context.
  const handleProps = useMemo(() => ({ ...attributes, ...listeners, ref: setActivatorNodeRef,
    onPointerDownCapture: scope?.resetClick, onTouchStartCapture: scope?.resetClick,
  }) as SortableItemState["handleProps"], [attributes, listeners, setActivatorNodeRef, scope?.resetClick]);
  return { ref, dragging: isDragging, sorting: !!scope?.active, consumeClick: scope?.consumeClick ?? (() => false),
    handleProps };
}
export function Draggable({ children, ...props }: DraggableProps & {
  children: (item: Pick<SortableItemState, "ref" | "handleProps" | "dragging" | "consumeClick">) => ReactNode;
}) {
  return children(useDraggableItem(props));
}

export function useDropTarget({ accepts, onDrop, disabled = false }: Target & { disabled?: boolean }) {
  const id = useId();
  const scope = useContext(DragScopeContext);
  const visible = useSurfaceVisibility();
  const inactive = disabled || !visible || !scope?.active || !accepts(scope.active.payload);
  const { setNodeRef, isOver, rect } = useDroppable({ id, disabled: inactive, data: { target: { accepts, onDrop } } });
  return { ref: setNodeRef, isOver: isOver && !inactive, rect };
}

export function DropTarget({ children, ...props }: Target & {
  disabled?: boolean; children: (target: ReturnType<typeof useDropTarget>) => ReactNode;
}) { return children(useDropTarget(props)); }

export function useActiveDragPayload() { return useContext(DragScopeContext)?.active?.payload ?? null; }
/** Layout coordinators can gate imperative work without rerendering their panes. */
export function useActiveDragPayloadRef() { return useContext(ActiveDragRefContext); }
