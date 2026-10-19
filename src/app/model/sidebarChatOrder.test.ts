// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import {
  loadSidebarChatOrder,
  orderSidebarChats,
  reorderSidebarChats,
  saveSidebarChatOrder,
} from "./sidebarChatOrder";

afterEach(() => localStorage.clear());

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
