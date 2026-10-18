// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateNotificationPreferences } from "../../notifications/model/notificationPreferences";
import { ApprovalToasts } from "./ApprovalToasts";

type Notice = ComponentProps<typeof ApprovalToasts>["notices"][number];
function notice(
  id: string,
  kind: Notice["kind"] = "approval",
  requestId = 1,
): Notice {
  return {
    sessionId: id,
    requestId,
    label: `Request ${id}`,
    kind,
    session: {
      id,
      cwd: `/projects/${id}`,
      title: id,
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [],
    },
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  onApproval.mockClear();
  onFocusSession.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const onApproval = vi.fn();
const onFocusSession = vi.fn();
function render(notices: Notice[], focusedSessionId?: string) {
  root.render(
    createElement(ApprovalToasts, {
      notices,
      focusedSessionId,
      onApproval,
      onFocusSession,
    }),
  );
}
function visibleRequests() {
  return [...document.querySelectorAll(".approval-toast")]
    .filter((item) => !item.closest('[aria-hidden="true"]'))
    .map((item) => item.textContent);
}

it.each(["question", "approval"] as const)(
  "automatically dismisses a %s without replaying it on updates or session switches",
  (kind) => {
    vi.useFakeTimers();
    act(() => render([notice("work", kind)]));
    act(() => vi.advanceTimersByTime(7999));
    expect(visibleRequests()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(visibleRequests()).toHaveLength(0);
    expect(
      document.querySelector('[data-fold-state="closing"][inert]'),
    ).not.toBeNull();
    act(() => vi.advanceTimersByTime(350));
    expect(document.querySelector(".approval-toast")).toBeNull();
    act(() => render([notice("work", kind)], "work"));
    act(() => render([notice("work", kind)]));
    expect(visibleRequests()).toHaveLength(0);
    expect(onApproval).not.toHaveBeenCalled();
    expect(onFocusSession).not.toHaveBeenCalled();
    act(() => render([notice("work", kind, 2)]));
    expect(visibleRequests()).toHaveLength(1);
  },
);

it("closes only the selected popup without answering or opening its session", () => {
  act(() => render([notice("work", "question"), notice("other")]));
  const close = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Close"]',
  )!;
  act(() => close.click());
  expect(visibleRequests()).toHaveLength(1);
  expect(visibleRequests()[0]).toContain("Request other");
  act(() => render([notice("work", "question"), notice("other")]));
  expect(visibleRequests()).toHaveLength(1);
  expect(onApproval).not.toHaveBeenCalled();
  expect(onFocusSession).not.toHaveBeenCalled();
});

it("consumes the reminder when its conversation is visited", () => {
  act(() => render([notice("work", "question")]));
  expect(visibleRequests()).toHaveLength(1);
  act(() => render([notice("work", "question")], "work"));
  expect(visibleRequests()).toHaveLength(0);
  act(() => render([notice("work", "question")]));
  expect(visibleRequests()).toHaveLength(0);
  act(() => render([]));
  act(() => render([notice("work", "question")]));
  expect(visibleRequests()).toHaveLength(1);
});

it("dismisses a clicked reminder even before navigation completes", () => {
  act(() => render([notice("work", "question")]));
  act(() =>
    document
      .querySelector<HTMLButtonElement>(".approval-toast button")!
      .click(),
  );
  expect(onFocusSession).toHaveBeenCalledWith("work");
  expect(visibleRequests()).toHaveLength(0);
});

it("keeps the popup available while its controls have keyboard focus", () => {
  vi.useFakeTimers();
  act(() => render([notice("work")]));
  const allow = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Allow",
  )!;
  act(() => allow.focus());
  act(() => vi.advanceTimersByTime(10_000));
  expect(visibleRequests()).toHaveLength(1);
  act(() => allow.blur());
  act(() => vi.advanceTimersByTime(8000));
  expect(visibleRequests()).toHaveLength(0);
});

it("hides muted project approval popups while another project's controls remain usable", async () => {
  updateNotificationPreferences(["local:/projects/private"], {
    mutedUntil: null,
  });
  act(() => render([notice("private"), notice("work")]));
  expect(visibleRequests()).toHaveLength(1);
  expect(visibleRequests()[0]).toContain("Request work");
  const allow = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Allow",
  )!;
  const deny = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Deny",
  )!;
  expect(allow.getAttribute("data-approval")).toBe("allow");
  expect(allow.getAttribute("data-variant") === "primary").toBe(true);
  expect(deny.getAttribute("data-approval")).toBe("deny");
  act(() => allow.click());
  expect(onApproval).toHaveBeenCalledWith("work", 1, "allow");
});

it("immediately hides an existing question when its notification category is disabled", async () => {
  await act(async () => render([notice("work", "question")]));
  expect(visibleRequests()).toHaveLength(1);
  act(() =>
    updateNotificationPreferences(["local:/projects/work"], {
      disabled: ["agentInput"],
    }),
  );
  expect(visibleRequests()).toHaveLength(0);
});

it("does not replay a mounted approval after its path is resumed", async () => {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const ids = ["local:/projects/work"];
  updateNotificationPreferences(ids, {
    mutedUntil: null,
  });
  await act(async () => render([notice("work")]));
  expect(visibleRequests()).toHaveLength(0);
  now += 1000;
  act(() =>
    updateNotificationPreferences(ids, {
      mutedUntil: undefined,
    }),
  );
  expect(visibleRequests()).toHaveLength(0);
  now += 1;
  await act(async () => render([notice("work", "approval", 2)]));
  expect(visibleRequests()).toHaveLength(1);
});

it.each(["resume", "expiry", "category"] as const)(
  "does not replay a suppressed request after %s, but shows a new request",
  async (reason) => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const ids = ["local:/projects/private"];
    updateNotificationPreferences(
      ids,
      reason === "category"
        ? { disabled: ["agentInput"] }
        : { mutedUntil: reason === "expiry" ? now + 60_000 : null },
    );
    await act(async () => render([notice("private", "question")]));
    expect(visibleRequests()).toHaveLength(0);
    now += 120_000;
    act(() => {
      if (reason === "resume")
        updateNotificationPreferences(ids, { mutedUntil: undefined });
      else if (reason === "category")
        updateNotificationPreferences(ids, { disabled: [] });
      else window.dispatchEvent(new Event("focus"));
    });
    expect(visibleRequests()).toHaveLength(0);
    now += 1;
    await act(async () => render([notice("private", "question", 2)]));
    expect(visibleRequests()).toHaveLength(1);
  },
);

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
