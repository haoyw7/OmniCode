import { layoutLeaves, type LayoutNode } from "./layout";

/** Keep a single conversation beside its tools when new columns no longer fit. */
export function fitToolLayout(
  layout: LayoutNode,
  sessionId: string,
  width: number,
  chatMinimum = 420,
  toolMinimum = 280,
): LayoutNode {
  if (width <= 0) return layout;
  const leaves = layoutLeaves(layout);
  const chat = leaves.find((pane) => pane.id === sessionId);
  const tools = leaves.filter((pane) => pane.id !== sessionId);
  // Explicit tools on the left, or chats in a vertical split, keep their placement.
  if (
    !chat ||
    tools.length < 2 ||
    chat.rect.x > 0.001 ||
    chat.rect.y > 0.001 ||
    chat.rect.h < 0.999 ||
    tools.some((pane) => pane.rect.x < chat.rect.w - 0.001)
  )
    return layout;
  if (
    chat.rect.w * width >= chatMinimum &&
    tools.every((pane) => pane.rect.w * width >= toolMinimum)
  )
    return layout;

  const chatShare =
    width >= chatMinimum + toolMinimum
      ? Math.min(
          1 - toolMinimum / width,
          Math.max(chat.rect.w, chatMinimum / width),
        )
      : chatMinimum / (chatMinimum + toolMinimum);
  const stacked = tools.every(
    (pane) =>
      Math.abs(pane.rect.x - chat.rect.w) < 0.001 &&
      Math.abs(pane.rect.w - (1 - chat.rect.w)) < 0.001,
  );
  if (stacked) return layout;

  const ordered = [...tools].sort(
    (a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y,
  );
  const toolNode: LayoutNode =
    ordered.length === 1
      ? { type: "leaf", id: ordered[0].id }
      : {
          type: "split",
          id: crypto.randomUUID(),
          dir: "down",
          children: ordered.map(({ id }) => ({ type: "leaf", id })),
          sizes: ordered.map(() => 1 / ordered.length),
        };
  return {
    type: "split",
    id: layout.type === "split" ? layout.id : crypto.randomUUID(),
    dir: "right",
    children: [{ type: "leaf", id: chat.id }, toolNode],
    sizes: [chatShare, 1 - chatShare],
  };
}
