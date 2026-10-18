// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotSettings } from "./BotSettings";
import type { BotHabit } from "../model/botHabits";
import { setUiLanguage } from "../../../shared/i18n/language";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

const habit: BotHabit = {
  id: "h1",
  name: "PR sweep",
  prompt: "Check open PRs",
  schedule: { scheduleKind: "weekly", minute: 0, time: "17:30", dayOfWeek: 5 },
  enabled: true,
  createdAt: 0,
  nextRunAt: Date.parse("2026-10-09T09:30:00Z"),
  lastOutcome: "quiet",
};
const render = (control: (input: object) => Promise<void>) => {
  const save = vi.fn(async () => {});
  act(() =>
    root.render(
      createElement(BotSettings, {
        value: null,
        catalog: { models: { codex: [{ id: "test", name: "Test", harness: "codex" }] }, errors: {} },
        projects: [],
        busy: false,
        onSave: save,
        habits: { items: [habit], timeZone: "Asia/Shanghai", control },
      }),
    ),
  );
  return save;
};
const button = (text: string) =>
  [...node.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const field = (label: string) =>
  [...node.querySelectorAll(".assistant-habit-editor label")]
    .find((item) => item.firstChild?.textContent === label)!
    .querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const settle = () => act(async () => {});

it("lists habits in the assistant's time zone and sends quick changes", async () => {
  const control = vi.fn(async () => {});
  render(control);
  act(() => button("Habits1 habits").click());
  const row = node.querySelector(".assistant-habit-list li")!;
  expect(row.textContent).toContain("Friday at 17:30");
  expect(row.textContent).toContain("Last run had nothing to report");
  act(() => button("Pause").click());
  await settle();
  act(() => button("Run now").click());
  await settle();
  expect(control.mock.calls).toEqual([
    [{ action: "updateHabit", habitId: "h1", habit: { enabled: false } }],
    [{ action: "runHabit", habitId: "h1" }],
  ]);
});

it("adds a habit from the editor without submitting the settings form", async () => {
  const control = vi.fn(async () => {});
  const save = render(control);
  act(() => button("Habits1 habits").click());
  act(() => button("Add habit").click());
  type(field("What to do"), "Summarize yesterday's merged PRs");
  const name = field("Name") as HTMLInputElement;
  type(name, "Morning digest");
  act(() =>
    [...node.querySelectorAll<HTMLInputElement>('input[name="assistant-habit-kind"]')][1].click(),
  );
  type(field("Time"), "08:15");
  await act(async () => {
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await settle();
  expect(save).not.toHaveBeenCalled();
  expect(control).toHaveBeenCalledWith({
    action: "createHabit",
    habit: {
      name: "Morning digest",
      prompt: "Summarize yesterday's merged PRs",
      schedule: { scheduleKind: "daily", minute: 0, time: "08:15", dayOfWeek: 1 },
    },
  });
});

it("keeps the editor open and shows the Host's error when a change fails", async () => {
  const control = vi.fn(async () => {
    throw new Error("Too many habits");
  });
  render(control);
  act(() => button("Habits1 habits").click());
  act(() => button("Add habit").click());
  type(field("Name"), "One more");
  type(field("What to do"), "Do it");
  act(() => node.querySelector<HTMLButtonElement>(".assistant-habit-editor .assistant-primary")!.click());
  await settle();
  expect(node.querySelector('[role="alert"]')?.textContent).toBe("Too many habits");
  expect((field("Name") as HTMLInputElement).value).toBe("One more");
});
