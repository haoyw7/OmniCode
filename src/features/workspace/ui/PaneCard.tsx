import type { CSSProperties, ReactNode } from "react";
import type { LayoutLeaf } from "../model/layout";

const PANE_BOUNDARY_EPSILON = 0.001;
const PANE_CARD_OUTER = 4;
const PANE_CARD_GAP = 2;

/** Outer window edges get the full gutter; shared edges split the gap between two cards. */
export function paneCardInset(rect: LayoutLeaf["rect"]): CSSProperties {
  const outer = `var(--desktop-pane-outer, ${PANE_CARD_OUTER}px)`;
  const gap = `var(--desktop-pane-half-gap, ${PANE_CARD_GAP}px)`;
  const side = (atEdge: boolean) => (atEdge ? outer : gap);
  return {
    paddingLeft: rect.x < PANE_BOUNDARY_EPSILON ? 0 : gap,
    paddingTop: rect.y < PANE_BOUNDARY_EPSILON ? 0 : gap,
    paddingRight: side(rect.x + rect.w > 1 - PANE_BOUNDARY_EPSILON),
    paddingBottom: side(rect.y + rect.h > 1 - PANE_BOUNDARY_EPSILON),
  };
}

export function PaneCardFrame({
  card,
  focused,
  children,
}: {
  card: boolean;
  focused: boolean;
  children: ReactNode;
}) {
  // Keep one element either way: folding a pane can toggle `card`, and a
  // changed wrapper would remount the chat, editors and running terminals.
  return (
    <div
      data-pane-background-geometry
      data-pane-card-frame={card ? "" : undefined}
      data-focused={card ? focused : undefined}
      className={card ? "pane-card" : "contents"}
    >
      {children}
    </div>
  );
}
