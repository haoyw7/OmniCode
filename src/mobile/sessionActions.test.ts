// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSessionActions } from "./MobileSessionActions";
import { setUiLanguage } from "../shared/i18n/language";
import type { HostSession } from "../features/connections/model/protocol";

const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async () => {}) }));
vi.mock("./transcriptPlatform", () => ({
  mobileTranscriptPlatform: clipboard,
}));
let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  vi.clearAllMocks();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
function render(
  options: { running?: boolean; pinned?: boolean; sidebar?: boolean } = {},
) {
  const snapshot: HostSession = {
    projectId: "project",
    revision: 1,
    status: options.running ? "running" : "idle",
    updatedAt: 1,
    pinned: options.pinned,
    session: {
      id: "session",
      title: "Conversation",
      cwd: "/project",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [],
      providerSessionId: "provider-session",
    },
  };
  const trigger = document.createElement("button");
  node.append(trigger);
  const onUpdate = vi.fn(async (_patch: object) => {});
  const onDelete = vi.fn(async () => {});
  const onMarkUnread = vi.fn(async () => {});
  const onClose = vi.fn();
  act(() =>
    root.render(
      createElement(MobileSessionActions, {
        snapshot: options.sidebar ? undefined : snapshot,
        summary: options.sidebar ? {
          ...snapshot, id: "sidebar-session", title: "Sidebar conversation", harness: "codex",
        } : undefined,
        anchor: { current: trigger },
        disabled: false,
        onUpdate,
        onDelete: options.sidebar ? undefined : onDelete,
        onMarkUnread: options.sidebar ? onMarkUnread : undefined,
        onClose,
      }),
    ),
  );
  return { onUpdate, onDelete, onClose, onMarkUnread };
}
function button(text: string) {
  return [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  )!;
}
function click(text: string) {
  act(() => button(text).click());
}
function input(value: string) {
  const field = node.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    node
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("mobile session management", () => {
  it("offers the five sidebar actions and colors archive red", () => {
    render({ sidebar: true });
    expect([...node.querySelectorAll(".mobile-session-actions button")].map(el => el.textContent?.trim()))
      .toEqual(["Pin", "Mark as unread", "Copy session ID", "Rename", "Archive"]);
    expect(button("Archive").classList.contains("mobile-menu-danger")).toBe(true);
  });
  it("marks the selected sidebar conversation unread and copies its ID directly", async () => {
    const { onMarkUnread, onClose } = render({ sidebar: true });
    await act(async () => button("Mark as unread").click());
    expect(onMarkUnread).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    render({ sidebar: true });
    await act(async () => button("Copy session ID").click());
    expect(clipboard.copyText).toHaveBeenCalledWith("sidebar-session");
  });
  it("renames and archives the selected sidebar conversation", async () => {
    const { onUpdate } = render({ sidebar: true });
    click("Rename");
    expect(node.querySelector("input")!.value).toBe("Sidebar conversation");
    input(" Renamed sidebar conversation ");
    await submit();
    expect(onUpdate).toHaveBeenCalledWith({ title: "Renamed sidebar conversation" });
    act(() => root.render(null));
    const archived = render({ sidebar: true });
    await act(async () => button("Archive").click());
    expect(archived.onUpdate).toHaveBeenCalledWith({ archived: true });
  });
  it.each([false, true])(
    "toggles persisted pin state from %s",
    async (pinned) => {
      const { onUpdate, onClose } = render({ pinned });
      await act(async () => button(pinned ? "Unpin" : "Pin").click());
      expect(onUpdate).toHaveBeenCalledWith({ pinned: !pinned });
      expect(onClose).toHaveBeenCalledOnce();
    },
  );
  it("keeps a failed rename open for retry and submits only a trimmed title", async () => {
    const { onUpdate, onClose } = render();
    click("Rename");
    input("  My new title  ");
    onUpdate.mockRejectedValueOnce(new Error("Host is offline"));
    await submit();
    expect(onUpdate).toHaveBeenCalledWith({ title: "My new title" });
    expect(node.querySelector('[role="alert"]')!.textContent).toBe(
      "Host is offline",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(node.querySelector("input")!.value).toBe("  My new title  ");
    await submit();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("requires delete confirmation, supports cancellation and deduplicates repeated taps", async () => {
    const { onDelete, onClose } = render();
    click("Delete");
    expect(onDelete).not.toHaveBeenCalled();
    click("Cancel");
    expect(onDelete).not.toHaveBeenCalled();
    click("Delete");
    let finish!: () => void;
    onDelete.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    act(() => {
      button("Delete").click();
      button("Delete").click();
    });
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("disables deleting a running session", () => {
    const { onDelete } = render({ running: true });
    expect(button("Delete").disabled).toBe(true);
    click("Delete");
    expect(onDelete).not.toHaveBeenCalled();
  });
  it("offers neither GitHub linking nor a new conversation", () => {
    render();
    expect(button("Link GitHub issue or PR…")).toBeUndefined();
    expect(button("New conversation")).toBeUndefined();
    expect(button("Rename")).toBeDefined();
  });
  it.each([
    ["Harness session ID", "provider-session"],
    ["OmniCode session ID", "session"],
  ])("copies the requested %s", async (label, value) => {
    render();
    click("Copy session ID");
    await act(async () => button(label).click());
    expect(clipboard.copyText).toHaveBeenCalledWith(value);
  });

});
