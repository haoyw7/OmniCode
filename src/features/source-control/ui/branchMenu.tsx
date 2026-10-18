import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";

/** Desktop skin is initialized before mounting the app, including popup windows. */
export function branchMenuLayout() {
  const desktop =
    typeof document !== "undefined" &&
    document.documentElement.hasAttribute("data-skin");
  return {
    desktop,
    width: desktop ? 320 : 280,
    maxHeight: desktop ? 360 : 280,
  };
}

/** Edge fades and scroll hints belong to the list, keeping search outside it. */
export function BranchMenuScrollArea({
  children,
}: Pick<ComponentPropsWithoutRef<"div">, "children">) {
  const scroll = useRef<HTMLDivElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [edges, setEdges] = useState({
    above: false,
    below: false,
  });
  const update = useCallback(() => {
    const el = scroll.current;
    if (!el) return;
    const above = el.scrollTop > 1;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((previous) =>
      previous.above === above &&
      previous.below === below
        ? previous
        : { above, below },
    );
  }, []);
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      scroll.current = el;
      lockOverscroll(el);
    },
    [lockOverscroll],
  );
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [children, update]);
  return (
    <div
      className="branch-menu-viewport"
      data-scroll-above={edges.above}
      data-scroll-below={edges.below}
    >
      <div className="branch-menu-scroll" onScroll={update} ref={attach}>
        {children}
      </div>
    </div>
  );
}
