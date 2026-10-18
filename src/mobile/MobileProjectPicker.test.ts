import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostDirectory } from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileProjectPicker } from "./MobileProjectPicker";

const home: HostDirectory = {
  path: "/home/me",
  parent: "/home",
  entries: [
    { name: "Code", path: "/home/me/Code" },
    { name: "个人项目", path: "/home/me/个人项目" },
  ],
};
const code: HostDirectory = {
  path: "/home/me/Code",
  parent: home.path,
  entries: [{ name: "My app", path: "/home/me/Code/My app" }],
};
let root: Root;
let node: HTMLDivElement;
let trigger: HTMLButtonElement;
let browseDirectories: ReturnType<
  typeof vi.fn<(path?: string) => Promise<HostDirectory>>
>;
let onOpen: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  trigger = document.createElement("button");
  document.body.append(node, trigger);
  root = createRoot(node);
  browseDirectories = vi.fn(async (path) => (path === code.path ? code : home));
  onOpen = vi.fn(async () => {});
  onClose = vi.fn();
});
afterEach(() => {
  stopMotionClock();
  act(() => root.unmount());
  node.remove();
  trigger.remove();
  setUiLanguage("en");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(open = true) {
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(MobileProjectPicker, {
          open,
          hostName: "My computer",
          anchor: { current: trigger },
          disabled: false,
          browseDirectories,
          onOpen,
          onClose,
        }),
      ),
    ),
  );
}
function button(label: string) {
  const value = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) ===
      label,
  );
  expect(value, `button ${label}`).toBeDefined();
  return value!;
}

it("browses only when opened, preserves closing content and refreshes after a completed exit", async () => {
  await render(false);
  expect(browseDirectories).not.toHaveBeenCalled();
  await render();
  await advanceMotionTimers(400);
  const count = browseDirectories.mock.calls.length;
  expect(count).toBeGreaterThan(0);
  const picker = node.querySelector(".mobile-project-picker")!;
  await render(false);
  expect(node.querySelector(".mobile-project-picker")).toBe(picker);
  expect(picker.closest("[inert]")).not.toBeNull();
  await render();
  expect(browseDirectories).toHaveBeenCalledTimes(count);
  expect(node.querySelector(".mobile-project-picker")).toBe(picker);
  await render(false);
  await advanceMotionTimers(600);
  expect(node.querySelector(".mobile-project-picker")).toBeNull();
  await render();
  expect(browseDirectories).toHaveBeenCalledTimes(count + 1);
});
async function click(label: string) {
  await act(async () => button(label).click());
}
function input(label: string, value: string) {
  const field = node.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function path() {
  return node.querySelector<HTMLInputElement>(
    'input[aria-label="Folder path"]',
  )!.value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("mobile Host project picker", () => {
  it("starts at the Host home without focusing a keyboard and navigates folders before opening", async () => {
    trigger.focus();
    await render();
    expect(browseDirectories).toHaveBeenCalledWith(undefined);
    expect(path()).toBe(home.path);
    expect(document.activeElement).toBe(node.querySelector('[role="dialog"]'));
    expect(node.textContent).toContain("My computer");
    await click("Code");
    expect(path()).toBe(code.path);
    expect(onOpen).not.toHaveBeenCalled();
    await click("Parent folder");
    expect(browseDirectories).toHaveBeenLastCalledWith(home.path);
    await click("Code");
    await click("Home folder");
    expect(browseDirectories).toHaveBeenLastCalledWith(undefined);
    await click("个人项目");
    expect(browseDirectories).toHaveBeenLastCalledWith("/home/me/个人项目");
    await click("Code");
    await click("Open project");
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(code.path);
  });

  it("filters only the current directory and handles empty folders and filesystem roots", async () => {
    await render();
    input("Filter folders", "code");
    expect(button("Code")).toBeDefined();
    expect(node.textContent).not.toContain("个人项目");
    input("Filter folders", "missing");
    expect(node.textContent).toContain("No matching folders");
    expect(path()).toBe(home.path);
    input("Filter folders", "");
    browseDirectories.mockResolvedValueOnce({
      path: "/",
      parent: null,
      entries: [],
    });
    await click("Home folder");
    expect(node.textContent).toContain("No subfolders");
    expect(button("Parent folder").disabled).toBe(true);
    expect(button("Open project").disabled).toBe(false);
    await click("Open project");
    expect(onOpen).toHaveBeenCalledWith("/");
  });

  it("allows explicit manual opening after a browse failure and retries the failed path", async () => {
    await render();
    const windowsPath = "D:\\My projects\\项目";
    input("Folder path", windowsPath);
    browseDirectories.mockRejectedValueOnce(new Error("Folder unavailable"));
    await click("Go to folder");
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      "Folder unavailable",
    );
    expect(path()).toBe(windowsPath);
    expect(onOpen).not.toHaveBeenCalled();
    browseDirectories.mockResolvedValueOnce({
      path: windowsPath,
      parent: "D:\\My projects",
      entries: [],
    });
    await click("Retry");
    expect(browseDirectories).toHaveBeenLastCalledWith(windowsPath);
    await click("Open project");
    expect(onOpen).toHaveBeenCalledWith(windowsPath);
    input("Folder path", "/known folder");
    await click("Open project");
    expect(onOpen).toHaveBeenLastCalledWith("/known folder");
  });

  it("lets manual input and a newer request win over late directory responses", async () => {
    await render();
    const old = deferred<HostDirectory>();
    browseDirectories.mockReturnValueOnce(old.promise);
    await click("Code");
    expect(button("Open project").disabled).toBe(true);
    input("Folder path", "/manual project");
    await act(async () => old.resolve(code));
    expect(path()).toBe("/manual project");
    expect(node.textContent).not.toContain("My app");
    await click("Go to folder");
    const stale = deferred<HostDirectory>();
    browseDirectories.mockReturnValueOnce(stale.promise);
    await click("Code");
    await click("Home folder");
    await act(async () => stale.resolve(code));
    expect(path()).toBe(home.path);
  });

  it("can return to the parent after entering a folder whose listing is denied", async () => {
    await render();
    browseDirectories.mockRejectedValueOnce(
      new Error("EACCES: permission denied, scandir '/home/me/Code'"),
    );
    await click("Code");
    expect(path()).toBe(code.path);
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      "EACCES",
    );
    expect(button("Parent folder").disabled).toBe(false);
    await click("Parent folder");
    expect(browseDirectories).toHaveBeenLastCalledWith(home.path);
    expect(path()).toBe(home.path);
    expect(node.querySelector('[role="alert"]')).toBeNull();
    expect(button("Code")).toBeDefined();
  });

  it("can leave a pending folder read and ignores its late failure", async () => {
    await render();
    const pending = deferred<HostDirectory>();
    browseDirectories.mockReturnValueOnce(pending.promise);
    await click("Code");
    expect(button("Parent folder").disabled).toBe(false);
    await click("Parent folder");
    await act(async () => pending.reject(new Error("Late EACCES")));
    expect(path()).toBe(home.path);
    expect(node.querySelector('[role="alert"]')).toBeNull();
    expect(button("Code")).toBeDefined();
  });

  it.each([
    ["/home/docker-data", "/home"],
    ["D:\\My projects\\private", "D:/My projects"],
    ["\\\\server\\share\\private", "//server/share"],
  ])(
    "retains the parent of a manually entered unreadable Host path %s",
    async (entered, parent) => {
      await render();
      input("Folder path", entered);
      browseDirectories.mockRejectedValueOnce(new Error("EACCES"));
      await click("Go to folder");
      expect(button("Parent folder").disabled).toBe(false);
      await click("Parent folder");
      expect(browseDirectories).toHaveBeenLastCalledWith(parent);
    },
  );

  it.each(["/", "D:\\", "\\\\server\\share\\"])(
    "has no parent above an unreadable filesystem root %s",
    async (entered) => {
      await render();
      input("Folder path", entered);
      browseDirectories.mockRejectedValueOnce(new Error("EACCES"));
      await click("Go to folder");
      expect(button("Parent folder").disabled).toBe(true);
      expect(node.querySelector('[role="alert"]')?.textContent).toContain(
        "EACCES",
      );
    },
  );

  it("keeps the picker and path after an open failure, prevents duplicate submissions and supports retry", async () => {
    await render();
    const pending = deferred<void>();
    onOpen.mockReturnValueOnce(pending.promise);
    await act(async () => {
      button("Open project").click();
      button("Open project").click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(button("Opening…").disabled).toBe(true);
    await click("Cancel");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error("Project unavailable")));
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      "Project unavailable",
    );
    expect(path()).toBe(home.path);
    expect(button("Open project").disabled).toBe(false);
    await click("Open project");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("ignores a pending response after cancellation and restores focus", async () => {
    await render();
    const pending = deferred<HostDirectory>();
    browseDirectories.mockReturnValueOnce(pending.promise);
    await click("Code");
    await click("Cancel");
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.render(null));
    expect(document.activeElement).toBe(trigger);
    await act(async () => pending.reject(new Error("Late network failure")));
    expect(node.querySelector('[role="alert"]')).toBeNull();
  });

  it("switches application labels live while preserving paths and Host folder names", async () => {
    await render();
    act(() => setUiLanguage("zh-CN"));
    expect(
      node.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
    ).toBe("打开项目");
    expect(button("用户目录")).toBeDefined();
    expect(button("上级目录")).toBeDefined();
    expect(button("个人项目")).toBeDefined();
    expect(
      node.querySelector<HTMLInputElement>('input[aria-label="文件夹路径"]')!
        .value,
    ).toBe(home.path);
    await click("打开项目");
    expect(onOpen).toHaveBeenCalledWith(home.path);
  });
});
