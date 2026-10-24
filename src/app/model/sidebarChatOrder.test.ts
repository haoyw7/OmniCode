// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { loadSidebarChatOrder, orderSidebarChats, reorderSidebarChats, saveSidebarChatOrder, subscribeSidebarChatOrder } from "./sidebarChatOrder";

afterEach(() => localStorage.clear());

it("notifies mounted chat lists of external reordering and detaches listeners", () => {
  const changed = vi.fn();
  const stop = subscribeSidebarChatOrder(changed);
  saveSidebarChatOrder(["b", "a"]);
  expect(changed).toHaveBeenCalledOnce();
  window.dispatchEvent(new StorageEvent("storage", { key: "omnicode.sidebarChatOrder.v1" }));
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  saveSidebarChatOrder(["a", "b"]);
  expect(changed).toHaveBeenCalledTimes(2);
});

const ids = (items: { id: string }[]) => items.map(({ id }) => id);

it("keeps manual chat order and puts unsaved chats first in recency order", () => {
  const items = ["new2", "new1", "a", "b", "c"].map((id) => ({ id }));
  expect(ids(orderSidebarChats(items, []))).toEqual(["new2", "new1", "a", "b", "c"]);
  expect(ids(orderSidebarChats(items, ["c", "a", "b"]))).toEqual([
    "new2",
    "new1",
    "c",
    "a",
    "b",
  ]);
});

it("saves the full list when reordering a preview so hidden rows keep their slots", () => {
  // Displayed: new, then saved b, a; c is listed but beyond the preview.
  expect(reorderSidebarChats(["b", "a", "c"], ["new", "b", "a", "c"], ["b", "new", "a"]))
    .toEqual(["b", "new", "a", "c"]);
});

it("keeps filtered chats in their saved slots while a search shows a subset", () => {
  expect(reorderSidebarChats(["a", "b", "c", "d"], ["b", "d"], ["d", "b"])).toEqual([
    "a",
    "d",
    "c",
    "b",
  ]);
});

it("round-trips the saved order and ignores malformed storage", () => {
  saveSidebarChatOrder(["b", "a", "b"]);
  expect(loadSidebarChatOrder()).toEqual(["b", "a"]);
  localStorage.setItem("omnicode.sidebarChatOrder.v1", "{");
  expect(loadSidebarChatOrder()).toEqual([]);
});
