// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startMotionClock, stopMotionClock, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { setUiLanguage } from "../../../shared/i18n/language";
import { projectKey, pathKey } from "../../../shared/lib/paths";
import { saveTabGroupLabel } from "../../workspace/model/tabGroups";
import { archiveProject, loadArchivedProjects, loadPinnedProjects, loadRecents, rememberProject } from "../model/recents";
import { rememberChatFolder } from "../model/chatFolders";
import { ProjectsPage } from "./ProjectsPage";

const animation = vi.hoisted(() => ({ ref: () => {}, enable: () => {} }));
vi.mock("@formkit/auto-animate/react", () => ({ useAutoAnimate: () => [animation.ref, animation.enable] }));

const A = "/work/alpha";
const B = "/work/beta";
const CHAT = "/home/me/Documents/ohmymonocode/2026-10-13/chat-120000-abcdef";
let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof ProjectsPage>;
const render = () => root.render(createElement(ProjectsPage, props));
const cards = () => [...container.querySelectorAll<HTMLElement>(".desktop-project-card")];
const card = (path: string) => cards().find(element => pathKey(element.querySelector<HTMLElement>(".desktop-project-path")!.title) === pathKey(path))!;
async function click(button: HTMLButtonElement | undefined | null) {
  expect(button).not.toBeNull();
  expect(button).not.toBeUndefined();
  await act(async () => button!.click());
  await act(async () => finishMotion());
}
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === label);
const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === label);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  localStorage.clear();
  setUiLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rememberProject(A);
  rememberProject(B);
  props = { mode: "code", cwd: A, recents: loadRecents(), onSelect: vi.fn(), onOpen: vi.fn(), onNewChat: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn() };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stopMotionClock();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("separates local and remote Code projects from Chat folders and routes existing actions", async () => {
  const remote = "remote://machine/home/me/repo";
  rememberChatFolder(CHAT);
  props.recents.push({ path: remote, openedAt: 1 });
  await act(async () => render());
  expect(cards()).toHaveLength(3);
  await click(card(remote).querySelector(".desktop-project-open"));
  expect(props.onSelect).toHaveBeenCalledWith(remote);
  await click(container.querySelector(".desktop-collection-create"));
  expect(props.onOpen).toHaveBeenCalledOnce();
  props.mode = "chat";
  await act(async () => render());
  expect(cards()).toHaveLength(1);
  expect(card(CHAT)).not.toBeUndefined();
  await click(container.querySelector(".desktop-collection-create"));
  expect(props.onNewChat).toHaveBeenCalledOnce();
});

it("uses normalized project names for Windows cards, search and live rename updates", async () => {
  const windows = "C:\\Users\\Me\\Repo";
  props.cwd = windows;
  props.recents = [{ path: windows, openedAt: 1 }, { path: A, openedAt: 2 }];
  saveTabGroupLabel(projectKey(windows), "Custom workspace");
  await act(async () => render());
  expect(card(windows).querySelector(".desktop-project-name")?.textContent).toBe("Custom workspace");
  await act(async () => saveTabGroupLabel(projectKey(windows), "Renamed workspace"));
  expect(card(windows).querySelector(".desktop-project-name")?.textContent).toBe("Renamed workspace");
  const input = container.querySelector<HTMLInputElement>('[aria-label="Search projects"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed workspace");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(cards()).toHaveLength(1);
});

it("refreshes pin badges and menu state immediately without a Host preference event", async () => {
  await act(async () => render());
  await click(card(A).querySelector(".desktop-project-more"));
  await click(menuItem("Pin"));
  expect(loadPinnedProjects()).toEqual([A]);
  expect(card(A).querySelector(".desktop-project-name svg")).not.toBeNull();
  await click(card(A).querySelector(".desktop-project-more"));
  await click(menuItem("Unpin"));
  expect(loadPinnedProjects()).toEqual([]);
  expect(card(A).querySelector(".desktop-project-name svg")).toBeNull();
});

it("archives and restores the selected real project while preserving its custom name", async () => {
  saveTabGroupLabel(projectKey(B), "Keep this name");
  props.onArchive = vi.fn(path => { props.recents = archiveProject(path); render(); });
  props.onRestore = vi.fn(path => { props.recents = rememberProject(path); render(); });
  await act(async () => render());
  await click(card(B).querySelector(".desktop-project-more"));
  await click(menuItem("Archive"));
  expect(props.onArchive).toHaveBeenCalledExactlyOnceWith(B);
  expect(card(B)).toBeUndefined();
  expect(loadArchivedProjects().map(project => project.path)).toEqual([B]);
  await click(tab("Archived"));
  expect(card(B).querySelector(".desktop-project-name")?.textContent).toBe("Keep this name");
  await click(card(B).querySelector(".desktop-project-open"));
  expect(props.onRestore).toHaveBeenCalledExactlyOnceWith(B);
  expect(loadArchivedProjects()).toEqual([]);
  await click(tab("Your projects"));
  expect(card(B).querySelector(".desktop-project-name")?.textContent).toBe("Keep this name");
});

it("dismisses a card menu when filtering removes its anchor", async () => {
  await act(async () => render());
  await click(card(A).querySelector(".desktop-project-more"));
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await click(tab("Archived"));
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
