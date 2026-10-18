// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { useBotDraft } from "./useBotDraft";

let root: Root;
let node: HTMLDivElement;
let update: (value: string) => void;
const key = (host: string) => `monocode.assistant-draft:${host}`;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Composer({ hostKey }: { hostKey: string }) {
  const [draft, setDraft] = useBotDraft(hostKey);
  update = setDraft;
  return createElement("textarea", { value: draft, readOnly: true });
}

function show(hostKey = "host", visible = true, instanceKey?: string) {
  act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible },
    createElement(Composer, { hostKey, key: instanceKey }),
  )));
}

function type(value: string) {
  act(() => update(value));
}

describe("assistant draft persistence", () => {
  it("loads the saved draft and combines typing into one write after 300 quiet milliseconds", () => {
    localStorage.setItem(key("host"), "Saved");
    const write = vi.spyOn(localStorage, "setItem");
    show();
    expect(node.querySelector("textarea")!.value).toBe("Saved");
    type("Saved draft");
    act(() => vi.advanceTimersByTime(200));
    type("Saved draft 输入");
    act(() => vi.advanceTimersByTime(299));
    expect(write).not.toHaveBeenCalled();
    expect(node.querySelector("textarea")!.value).toBe("Saved draft 输入");
    act(() => vi.advanceTimersByTime(1));
    expect(write).toHaveBeenCalledExactlyOnceWith(key("host"), "Saved draft 输入");
    act(() => root.render(null));
    expect(write).toHaveBeenCalledOnce();
  });

  it.each(["document hidden", "pagehide", "surface hidden", "unmount"])("flushes the latest pending draft on %s", (reason) => {
    show();
    type("Do not lose this draft");
    const write = vi.spyOn(localStorage, "setItem");
    if (reason === "document hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    } else if (reason === "pagehide") {
      act(() => window.dispatchEvent(new Event("pagehide")));
    } else if (reason === "surface hidden") show("host", false);
    else act(() => root.render(null));
    expect(write).toHaveBeenCalledExactlyOnceWith(key("host"), "Do not lose this draft");
    act(() => vi.advanceTimersByTime(1000));
    expect(write).toHaveBeenCalledOnce();
  });

  it("flushes the old Host before loading another Host and keeps late send clearing scoped to its owner", () => {
    localStorage.setItem(key("first"), "First saved");
    localStorage.setItem(key("second"), "Second saved");
    show("first");
    type("First edited");
    const completeFirstSend = update;
    show("second");
    expect(localStorage.getItem(key("first"))).toBe("First edited");
    expect(node.querySelector("textarea")!.value).toBe("Second saved");
    type("Second edited");
    act(() => completeFirstSend(""));
    expect(localStorage.getItem(key("first"))).toBe("");
    expect(node.querySelector("textarea")!.value).toBe("Second edited");
    expect(localStorage.getItem(key("second"))).toBe("Second saved");
    act(() => vi.advanceTimersByTime(300));
    expect(localStorage.getItem(key("second"))).toBe("Second edited");
    show("first");
    expect(node.querySelector("textarea")!.value).toBe("");
    show("second");
    expect(node.querySelector("textarea")!.value).toBe("Second edited");
  });

  it("persists clearing immediately and never restores the pending text afterward", () => {
    localStorage.setItem(key("host"), "Earlier draft");
    show();
    type("Pending draft");
    act(() => vi.advanceTimersByTime(100));
    type("");
    expect(localStorage.getItem(key("host"))).toBe("");
    act(() => vi.advanceTimersByTime(1000));
    expect(localStorage.getItem(key("host"))).toBe("");
  });

  it.each([false, true])("protects a newer saved draft from an old send after returning to its Host (left again: %s)", (leaveAgain) => {
    show("first");
    type("Message still sending");
    const completeFirstSend = update;
    show("second");
    show("first");
    type("A new draft after returning");
    act(() => vi.advanceTimersByTime(300));
    expect(localStorage.getItem(key("first"))).toBe("A new draft after returning");
    if (leaveAgain) show("second");
    act(() => completeFirstSend(""));
    expect(localStorage.getItem(key("first"))).toBe("A new draft after returning");
    if (!leaveAgain) expect(node.querySelector("textarea")!.value).toBe("A new draft after returning");
    // The newer owner may already consider its text saved; leaving must not
    // leave an old completion's empty storage value behind.
    show("second");
    show("first");
    expect(node.querySelector("textarea")!.value).toBe("A new draft after returning");
  });

  it("ignores a late send from an unmounted Host after its composer is mounted again", () => {
    show("first", true, "first");
    type("Message still sending");
    const completeFirstSend = update;
    show("second", true, "second");
    expect(localStorage.getItem(key("first"))).toBe("Message still sending");
    show("first", true, "first");
    type("Saved by the new composer");
    act(() => vi.advanceTimersByTime(300));
    act(() => completeFirstSend(""));
    expect(node.querySelector("textarea")!.value).toBe("Saved by the new composer");
    expect(localStorage.getItem(key("first"))).toBe("Saved by the new composer");
    show("second", true, "second");
    show("first", true, "first");
    expect(node.querySelector("textarea")!.value).toBe("Saved by the new composer");
  });

  it("retains the draft if storage fails and retries when leaving the page", () => {
    show();
    type("Keep in memory");
    const write = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage full");
    });
    act(() => vi.advanceTimersByTime(300));
    expect(node.querySelector("textarea")!.value).toBe("Keep in memory");
    expect(localStorage.getItem(key("host"))).toBeNull();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(write).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(key("host"))).toBe("Keep in memory");
  });
});
