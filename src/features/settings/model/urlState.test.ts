// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSettingsSection } from "./useSettingsSection";
import { loadSettingsSection } from "./settings";
import { useInboxQueryState } from "../../inbox/model/useInboxQueryState";
import { DEFAULT_INBOX_FILTERS, loadInboxFilters } from "../../inbox/model/inboxFilters";
import { useQuickOpenMode } from "../../search/model/useQuickOpenMode";
import { useReviewTab } from "../../source-control/model/useReviewTab";

let root: Root;
let container: HTMLDivElement;
let section: ReturnType<typeof useSettingsSection>;
let inbox: ReturnType<typeof useInboxQueryState>;
let quick: ReturnType<typeof useQuickOpenMode>;
let reviewA: ReturnType<typeof useReviewTab>;
let reviewB: ReturnType<typeof useReviewTab>;
function Probe({ cwd = "/a" }: { cwd?: string }) {
  section = useSettingsSection();
  inbox = useInboxQueryState();
  quick = useQuickOpenMode();
  reviewA = useReviewTab(cwd, undefined, undefined, "unstaged");
  reviewB = useReviewTab("/b", "s2", undefined, "session");
  return null;
}
async function render(cwd?: string) {
  await act(async () => root.render(createElement(NuqsAdapter, null, createElement(Probe, { cwd }))));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  history.replaceState(null, "", "/?window=keep#anchor");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

it("restores valid URL values ahead of persisted defaults and keeps preferences", async () => {
  localStorage.setItem("omnicode.settingsSection", "chat");
  localStorage.setItem("omnicode.inboxFilters", JSON.stringify(DEFAULT_INBOX_FILTERS));
  const params = new URLSearchParams({ settings: "appearance", quickOpen: "commands", inboxFilters: JSON.stringify({ ...DEFAULT_INBOX_FILTERS, time: "7d" }) });
  history.replaceState(null, "", `/?${params}`);
  await render();
  expect(section[0]).toBe("appearance");
  expect(quick[0]).toBe("commands");
  expect(inbox.filters.time).toBe("7d");
  expect(loadSettingsSection()).toBe("appearance");
  expect(loadInboxFilters().time).toBe("7d");
});

it("falls back safely for invalid URL data", async () => {
  history.replaceState(null, "", "/?settings=unknown&quickOpen=bad&inboxFilters=%7B%7D&inboxSource=bad");
  await render();
  expect(section[0]).toBe("general");
  expect(quick[0]).toBe("files");
  expect(inbox.filters).toEqual(DEFAULT_INBOX_FILTERS);
  expect(inbox.source).toBe("github");
});

it("batches changes, preserves unrelated URL state, and responds to navigation", async () => {
  await render();
  await act(async () => {
    const updates = [section[1]("appearance"), quick[1]("projects"), inbox.setFilters({ ...DEFAULT_INBOX_FILTERS, assignedToMe: true })];
    await Promise.all(updates);
  });
  const query = new URLSearchParams(location.search);
  expect(query.get("window")).toBe("keep");
  expect(location.hash).toBe("#anchor");
  expect(query.get("settings")).toBe("appearance");
  expect(query.get("quickOpen")).toBe("projects");
  expect(loadInboxFilters().assignedToMe).toBe(true);
  await act(async () => {
    history.replaceState(null, "", "/?settings=chat&quickOpen=sessions");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(section[0]).toBe("chat");
  expect(quick[0]).toBe("sessions");
});

it("isolates review scopes and resets the selected source when the scope changes", async () => {
  await render();
  await act(async () => { await reviewA[1]("staged"); });
  expect(reviewA[0]).toBe("staged");
  expect(reviewB[0]).toBe("session");
  await render("/c");
  expect(reviewA[0]).toBe("unstaged");
  await render("/a");
  expect(reviewA[0]).toBe("staged");
});
