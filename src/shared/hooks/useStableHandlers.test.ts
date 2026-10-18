// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useStableHandlers } from "./useStableHandlers";

type Handlers = { onPick?: (value: number) => string; label: string };

it("keeps handler identity across renders while calling the latest one", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: Handlers[] = [];
  function Probe(props: Handlers) {
    seen.push(useStableHandlers<Handlers>(props));
    return null;
  }
  const node = document.createElement("div");
  const root = createRoot(node);
  try {
    act(() => root.render(createElement(Probe, { onPick: (v) => `a${v}`, label: "one" })));
    act(() => root.render(createElement(Probe, { onPick: (v) => `b${v}`, label: "two" })));
    const [first, second] = seen;
    expect(second.onPick).toBe(first.onPick);
    expect(first.onPick?.(1)).toBe("b1");
    expect(second.label).toBe("two");

    // A withdrawn handler is visibly absent, and a stale forwarder is a no-op.
    act(() => root.render(createElement(Probe, { label: "three" })));
    expect(seen[2].onPick).toBeUndefined();
    expect(first.onPick?.(2)).toBeUndefined();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
