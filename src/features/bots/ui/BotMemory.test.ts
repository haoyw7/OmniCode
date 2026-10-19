// @vitest-environment happy-dom
import { act, createElement } from "react";
import { finishMotion, startMotionClock, stopMotionClock } from "../../../../tests/helpers/sharedMotionClock";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotSettings } from "./BotSettings";
import type { BotMemory } from "../model/botView";
import type { BotMemoryDetailProps } from "./BotChatChrome";
import { setUiLanguage } from "../../../shared/i18n/language";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  stopMotionClock();
  node.remove();
  vi.unstubAllGlobals();
});

/** A Host that keeps memory facts and rejects edits made against an old version. */
function fakeHost() {
  const memory: BotMemory = {
    revision: 1,
    facts: [{ index: 0, text: "Prefers pnpm", date: "2026-10-01", struck: false }],
    topics: [],
  };
  const rpc = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "assistant.memory") return structuredClone(memory);
    if (params.expectedRevision !== memory.revision)
      throw new Error("Memory changed elsewhere. Reload before saving.");
    memory.revision++;
    if (params.action === "addMemory")
      memory.facts.push({ index: memory.facts.length, text: String(params.fact), struck: false });
    if (params.action === "editMemory")
      memory.facts[Number(params.index)].text = String(params.fact);
    return {};
  });
  return { memory, rpc: rpc as never as <T>(method: string, params?: object) => Promise<T>, calls: rpc };
}

const render = (host: ReturnType<typeof fakeHost>, extra: object = {}) => {
  const save = vi.fn(async () => {});
  act(() =>
    root.render(
      createElement(BotSettings, {
        value: null,
        catalog: { models: { codex: [{ id: "test", name: "Test", harness: "codex" }] }, errors: {} },
        projects: [],
        busy: false,
        onSave: save,
        memory: { rpc: host.rpc, revision: host.memory.revision, lines: host.memory.facts.length },
        ...extra,
      }),
    ),
  );
  return save;
};
// The desktop memory dialog renders in a portal outside the settings node.
const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const settle = () => act(async () => {});
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const enter = (field: HTMLInputElement) =>
  act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });

it("waits for the memory response before starting the disclosure", async () => {
  const host = fakeHost();
  let resolve!: (value: BotMemory) => void;
  host.calls.mockImplementationOnce(() => new Promise<BotMemory>(done => { resolve = done; }));
  render(host);
  act(() => button("Memory").click());
  await settle();
  const fold = node.querySelector<HTMLElement>('.assistant-memory')!.closest<HTMLElement>('[data-collapse-motion]')!;
  await act(async () => finishMotion());
  expect(fold.dataset.foldState).toBe("closed");
  expect(fold.style.height).toBe("0px");
  expect(fold.inert).toBe(true);
  await act(async () => resolve(structuredClone(host.memory)));
  expect(fold.dataset.foldState).toBe("opening");
  expect(fold.textContent).toContain("Prefers pnpm");
  await act(async () => finishMotion());
  expect(fold.dataset.foldState).toBe("open");
  act(() => button("Memory").click());
  act(() => button("Memory").click());
  await act(async () => finishMotion());
  expect(fold.dataset.foldState).toBe("open");
  act(() => button("Memory").click());
  await act(async () => finishMotion());
  expect(node.querySelector('.assistant-memory')).toBeNull();
  act(() => button("Memory").click());
  await settle();
  await act(async () => finishMotion());
  expect(node.querySelector('.assistant-memory')?.closest<HTMLElement>('[data-collapse-motion]')?.dataset.foldState).toBe("open");
});

it("ignores a cancelled load and opens to show a failed request", async () => {
  const host = fakeHost();
  let resolve!: (value: BotMemory) => void;
  host.calls.mockImplementationOnce(() => new Promise<BotMemory>(done => { resolve = done; }));
  render(host);
  act(() => button("Memory").click());
  await settle();
  act(() => button("Memory").click());
  await act(async () => finishMotion());
  await act(async () => resolve(structuredClone(host.memory)));
  expect(node.querySelector('.assistant-memory')).toBeNull();
  host.calls.mockRejectedValueOnce(new Error("Memory unavailable"));
  act(() => button("Memory").click());
  await settle();
  await act(async () => finishMotion());
  const memory = node.querySelector<HTMLElement>('.assistant-memory')!;
  expect(memory.closest<HTMLElement>('[data-collapse-motion]')?.dataset.foldState).toBe("open");
  expect(memory.querySelector('[role="alert"]')?.textContent).toBe("Memory unavailable");
});

it("loads memory only when opened and edits it without submitting the settings form", async () => {
  const host = fakeHost();
  const save = render(host);
  expect(button("Memory").textContent).toContain("1 remembered facts");
  expect(host.calls).not.toHaveBeenCalled();
  act(() => button("Memory").click());
  await settle();
  expect(node.querySelector(".assistant-memory-list")?.textContent).toContain("Prefers pnpm");

  const add = node.querySelector<HTMLInputElement>('.assistant-memory-add input')!;
  type(add, "Deploys on Fridays are off");
  await enter(add);
  await settle();
  expect(save).not.toHaveBeenCalled();
  expect(add.value).toBe("");
  expect(node.querySelector(".assistant-memory-list")?.textContent).toContain("Deploys on Fridays are off");

  act(() => node.querySelector<HTMLButtonElement>(".assistant-memory-row")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("2026-10-01");
  const edit = dialog.querySelector("textarea")!;
  expect(edit.value).toBe("Prefers pnpm");
  await act(async () => finishMotion());
  type(edit, "Prefers bun");
  await act(async () => button("Save").click());
  await settle();
  expect(document.querySelector<HTMLElement>('[role="dialog"]')?.inert).toBe(true);
  await act(async () => finishMotion());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.calls).toHaveBeenCalledWith(
    "assistant.control",
    expect.objectContaining({ action: "editMemory", index: 0, fact: "Prefers bun", expectedRevision: 2 }),
  );
  expect(node.querySelector(".assistant-memory-list")?.textContent).toContain("Prefers bun");
  expect(save).not.toHaveBeenCalled();
});

it("shows a conflict and reloads instead of overwriting a newer memory", async () => {
  const host = fakeHost();
  render(host);
  act(() => button("Memory").click());
  await settle();
  host.memory.revision = 5; // The assistant wrote meanwhile.
  host.memory.facts[0].text = "Prefers yarn";
  act(() => node.querySelector<HTMLButtonElement>(".assistant-memory-row")!.click());
  await act(async () => button("Forget").click());
  await settle();
  // The conflict stays in the open dialog next to the fact it concerns.
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toMatch(/changed elsewhere/);
  expect(node.querySelector(".assistant-memory-list")?.textContent).toContain("Prefers yarn");
});

it("lists facts on one line and edits them in the platform panel", async () => {
  const host = fakeHost();
  const MemoryDetail = (props: BotMemoryDetailProps) =>
    createElement(
      "div",
      { className: "memory-detail", "data-open": props.open },
      createElement("p", null, props.text),
      createElement("small", null, props.meta),
      createElement("button", { type: "button", onClick: () => props.onSave("Prefers bun") }, "Save fact"),
    );
  render(host, { MemoryDetail });
  act(() => button("Memory").click());
  await settle();
  const row = node.querySelector<HTMLButtonElement>(".assistant-memory-row")!;
  expect(row.querySelector("time")?.textContent).toBe("2026-10-01");
  expect(row.querySelector(".assistant-memory-row-text")?.textContent).toBe("Prefers pnpm");
  expect(node.querySelector(".assistant-memory-list")?.textContent).not.toContain("Forget");
  expect(node.querySelector(".memory-detail")).toBeNull();

  act(() => row.click());
  const detail = node.querySelector(".memory-detail")!;
  expect(detail.getAttribute("data-open")).toBe("true");
  expect(detail.textContent).toContain("2026-10-01");
  await act(async () => button("Save fact").click());
  await settle();
  expect(host.calls).toHaveBeenCalledWith(
    "assistant.control",
    expect.objectContaining({ action: "editMemory", index: 0, fact: "Prefers bun" }),
  );
  expect(node.querySelector(".memory-detail")?.getAttribute("data-open")).toBe("false");
  expect(node.querySelector(".assistant-memory-row-text")?.textContent).toBe("Prefers bun");
  expect(document.querySelector("[data-status-toast-host]")?.textContent).toContain("Memory updated");
});
