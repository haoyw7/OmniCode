import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { LAYER } from "../../lib/layers";
import { Popover } from "../Popover";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../SurfaceVisibility";

type Props = ComponentProps<typeof Popover> & {
  appearance?: "composer";
  /** Inset surface used by the composer, without changing the requested width. */
  inset?: boolean;
  /** Nested menus open alongside their row and return focus with Left/Escape. */
  submenu?: boolean;
};

const MenuTree = createContext<{
  id: string;
  addChild: () => () => void;
} | null>(null);

export function menuPanelWidth(
  appearance: Props["appearance"],
  fallback: number,
) {
  if (
    appearance !== "composer" ||
    typeof document === "undefined" ||
    !document.documentElement.dataset.skin
  )
    return fallback;
  const mode = document.documentElement.dataset.desktopMode;
  return mode === "chat" || mode === "code" ? 242 : fallback;
}

/** Shared menu placement, presentation and animated lifetime. Content stays feature-owned. */
export function MenuPanel({
  open,
  appearance,
  inset = appearance === "composer",
  submenu = false,
  children,
  className,
  width,
  autoFocus,
  onDismiss,
  onKeyDown,
  anchor,
  side = submenu ? "right" : "top",
  align = "start",
  gap = submenu ? 4 : undefined,
  layer = submenu ? LAYER.submenu : undefined,
  ignore,
  dismissOnEscape = true,
  ...props
}: Props) {
  const expanded = open ?? true;
  const visible = useSurfaceVisibility();
  const parent = useContext(MenuTree);
  const ownId = useId();
  const treeId = parent?.id ?? ownId;
  const [childCount, setChildCount] = useState(0);
  const tree = useMemo(
    () => ({
      id: treeId,
      addChild: () => {
        setChildCount((count) => count + 1);
        return () => setChildCount((count) => count - 1);
      },
    }),
    [treeId],
  );
  useEffect(() => {
    if (expanded && visible) return parent?.addChild();
  }, [parent, expanded, visible]);
  const retainedChildren = useRef(children);
  if (expanded) retainedChildren.current = children;
  const restoreFocus = () => {
    if (anchor instanceof HTMLElement) anchor.focus({ preventScroll: true });
    else if (anchor && "current" in anchor)
      anchor.current?.focus({ preventScroll: true });
  };
  return (
    <Popover
      {...props}
      open={open === undefined ? undefined : expanded && visible}
      anchor={anchor}
      side={side}
      align={align}
      gap={gap}
      layer={layer}
      width={
        width === undefined ? undefined : menuPanelWidth(appearance, width)
      }
      bare={inset || props.bare}
      data-ui="menu-panel"
      data-submenu={submenu || undefined}
      data-menu-tree={treeId}
      ignore={[ignore, `[data-menu-tree="${treeId}"]`]
        .filter(Boolean)
        .join(",")}
      dismissOnEscape={dismissOnEscape && childCount === 0}
      className={`${inset ? "composer-popover " : ""}${appearance === "composer" ? "composer-menu-panel font-sans " : ""}${className ?? ""}`}
      inert={!expanded || !visible || props.inert}
      aria-hidden={!expanded || !visible || props["aria-hidden"]}
      autoFocus={expanded && autoFocus}
      onDismiss={
        expanded && visible && onDismiss
          ? (reason) => {
              onDismiss?.(reason);
              if (submenu && reason === "escape") restoreFocus();
            }
          : undefined
      }
      onKeyDown={(event) => {
        if (
          submenu &&
          onDismiss &&
          event.key === "ArrowLeft" &&
          !event.defaultPrevented &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
          event.stopPropagation();
          onDismiss?.("escape");
          restoreFocus();
          return;
        }
        onKeyDown?.(event);
      }}
    >
      <MenuTree.Provider value={tree}>
        <MenuPanelContent open={expanded} inset={inset}>
          {expanded ? children : retainedChildren.current}
        </MenuPanelContent>
      </MenuTree.Provider>
    </Popover>
  );
}

function MenuPanelContent({
  open,
  inset,
  children,
}: {
  open: boolean;
  inset: boolean;
  children: ReactNode;
}) {
  const visible = useSurfaceVisibility();
  return (
    <SurfaceVisibilityContext.Provider value={visible && open}>
      {inset ? (
        <div className="composer-popover-gutter">{children}</div>
      ) : (
        children
      )}
    </SurfaceVisibilityContext.Provider>
  );
}
