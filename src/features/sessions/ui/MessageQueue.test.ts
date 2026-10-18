// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageQueue } from "./MessageQueue";
import { setUiLanguage } from "../../../shared/i18n/language";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
function render(props: Partial<Parameters<typeof MessageQueue>[0]> = {}) {
  const onEdit = vi.fn();
  const onEditingChange = vi.fn();
  const onDelete = vi.fn();
  const onSteer = vi.fn();
  const onResume = vi.fn();
  act(() =>
    root.render(
      createElement(MessageQueue, {
        messages: [{ id: "row", text: "Queued text", attachments: [] }],
        onEdit,
        onEditingChange,
        onDelete,
        onSteer,
        onResume,
        ...props,
      }),
    ),
  );
  const click = async (label: string) =>
    act(async () =>
      node
        .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
        .click(),
    );
  return { onEdit, onEditingChange, onDelete, onSteer, onResume, click };
}
it("preserves synchronous desktop editing and cancels with Escape", async () => {
  const s = render();
  await s.click("Edit queued message");
  expect(node.querySelector("textarea")?.value).toBe("Queued text");
  expect(s.onEditingChange).toHaveBeenCalledWith("row");
  act(() =>
    node
      .querySelector("textarea")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(node.querySelector("textarea")).toBeNull();
  expect(s.onEditingChange).toHaveBeenLastCalledWith();
});
it("waits for the shared edit lease and retains the draft on save rejection", async () => {
  let accept!: () => void;
  const onEditingChange = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  const onEdit = vi.fn(async () => {
    throw new Error("Edit expired");
  });
  const s = render({ remote: true, onEditingChange, onEdit });
  await s.click("Edit queued message");
  expect(node.querySelector("textarea")).toBeNull();
  await act(async () => accept());
  expect(node.querySelector("textarea")?.value).toBe("Queued text");
  await s.click("Save queued message");
  expect(node.querySelector("textarea")?.value).toBe("Queued text");
  expect(node.querySelector('[role="alert"]')?.textContent).toContain(
    "Edit expired",
  );
});
it("renews remote edit leases and releases them when leaving the conversation", async () => {
  vi.useFakeTimers();
  try {
    const onEditingChange = vi.fn(async () => {});
    const s = render({ remote: true, onEditingChange });
    await s.click("Edit queued message");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(onEditingChange).toHaveBeenCalledTimes(2);
    act(() => root.render(null));
    expect(onEditingChange).toHaveBeenLastCalledWith();
  } finally {
    vi.useRealTimers();
  }
});
it("disables unavailable steer while leaving edit and delete usable", async () => {
  const s = render({ canSteer: false });
  expect(
    [...node.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Steer"),
    )?.disabled,
  ).toBe(true);
  await s.click("Remove queued message");
  expect(s.onDelete).toHaveBeenCalledWith("row");
});
it("shows a localized shared paused queue with an explicit resume action", () => {
  setUiLanguage("zh-CN");
  const s = render({ remote: true, status: "paused" });
  expect(node.textContent).toContain("队列已暂停");
  const resume = [...node.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("继续"),
  )!;
  act(() => resume.click());
  expect(s.onResume).toHaveBeenCalledTimes(1);
});
