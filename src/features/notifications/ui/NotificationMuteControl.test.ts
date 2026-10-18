import { duration } from "../../../shared/motion/tokens";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import { NotificationMuteControl } from "./NotificationMuteControl";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) =>
      item.textContent === label ||
      item.getAttribute("aria-label") === label ||
      item.textContent?.startsWith(`${label} (`),
  );
  expect(button, `Button ${label}`).toBeDefined();
  act(() => button!.click());
}

describe("NotificationMuteControl", () => {
  it.each(["single", "batch", "muted"])(
    "closes and reopens the %s menu from the original trigger with pointer events",
    async (mode) => {
      vi.useFakeTimers();
      try {
        if (mode === "muted")
          updateNotificationPreferences(["private"], {
            disabled: ["issues"],
            mutedUntil: null,
          });
        const original = loadNotificationPreferences();
        await act(async () =>
          root.render(
            createElement(NotificationMuteControl, {
              projectIds:
                mode === "batch" ? ["private", "personal"] : ["private"],
            }),
          ),
        );
        const trigger = container.querySelector<HTMLButtonElement>(
          "button[aria-haspopup]",
        )!;
        const press = async () => {
          await act(async () =>
            trigger
              .querySelector("svg")!
              .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
          );
          await act(async () => trigger.click());
        };
        await press();
        const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
        await press();
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(menu.inert).toBe(true);
        expect(menu.getAttribute("aria-hidden")).toBe("true");
        await press();
        expect(document.querySelector('[role="menu"]')).toBe(menu);
        expect(menu.inert).toBe(false);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        await act(async () => vi.advanceTimersByTimeAsync(duration.pop * 1000));
        await press();
        await act(async () => vi.advanceTimersByTimeAsync(duration.pop * 1000));
        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(loadNotificationPreferences()).toEqual(original);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("mutes selected projects for eight hours without replacing category choices", () => {
    updateNotificationPreferences(["private"], { disabled: ["issues"] });
    act(() =>
      root.render(
        createElement(NotificationMuteControl, {
          projectIds: ["private", "personal"],
        }),
      ),
    );
    click("Mute notifications");
    click("8 hours");
    expect(loadNotificationPreferences()).toEqual({
      private: { disabled: ["issues"], mutedUntil: 1_800_028_800_000 },
      personal: { disabled: [], mutedUntil: 1_800_028_800_000 },
    });
  });

  it("resumes notifications while preserving the project's chosen categories", () => {
    updateNotificationPreferences(["private"], {
      disabled: ["issues"],
      mutedUntil: null,
    });
    act(() =>
      root.render(
        createElement(NotificationMuteControl, { projectIds: ["private"] }),
      ),
    );
    expect(container.textContent).toContain("Muted until resumed");
    click("Resume notifications");
    expect(loadNotificationPreferences().private.disabled).toEqual(["issues"]);
    expect(loadNotificationPreferences().private.mutedUntil).toBeUndefined();
    expect(container.textContent).not.toContain("Muted until resumed");
  });

  it("accepts a custom future time and rejects an expired one without saving", () => {
    vi.mocked(Date.now).mockReturnValue(new Date(2030, 0, 15, 12).getTime());
    act(() =>
      root.render(
        createElement(NotificationMuteControl, { projectIds: ["private"] }),
      ),
    );
    click("Mute notifications");
    click("Choose date and time");
    expect(
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent === "1 hour",
      ),
    ).toBe(false);
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(document.querySelector('[role="grid"]')).not.toBeNull();
    expect(
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Mute until then")
        ?.getAttribute("data-ui") === "button",
    ).toBe(true);
    expect(
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Mute until then")
        ?.getAttribute("data-variant") === "primary",
    ).toBe(true);
    act(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="2030-01-15"]')!
        .click(),
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="HH:mm"]',
    );
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const type = (value: string) =>
      act(() => {
        setter.call(input, value);
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("08:00");
    click("Mute until then");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "future",
    );
    expect(loadNotificationPreferences().private).toBeUndefined();
    act(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="2030-01-16"]')!
        .click(),
    );
    type("17:00");
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    click("Mute until then");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save",
    );
    expect(input!.value).toBe("17:00");
    write.mockRestore();
    click("Mute until then");
    expect(loadNotificationPreferences().private.mutedUntil).toBe(
      new Date(2030, 0, 16, 17).getTime(),
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Change mute duration",
    );
  });
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
