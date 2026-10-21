// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { queryClient } from "../../../../shared/lib/queryClient";
import { useTranscriptPaging } from "./useTranscriptPaging";
import type { Block } from "../../model/session";
import type { PrependScrollAnchor } from "./useTurnScrollAnchor";

it.each([false, true])("preserves the current reader position when a remote page commits (partial turn: %s)", async partial => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  let commit!: () => void;
  let scroller!: HTMLDivElement;
  function Harness() {
    const [turns, setTurns] = useState<Block[][]>([[{ id: "old", role: "assistant", text: "Old" }]]);
    const ref = useRef<HTMLDivElement | null>(null), anchor = useRef<PrependScrollAnchor | null>(null);
    const stick = useRef(false), distance = useRef(0), wheel = useRef(0);
    const paging = useTranscriptPaging({ turns, scroller: ref, prependAnchor: anchor,
      stickToBottom: stick, distanceFromBottom: distance, wheelHold: wheel,
      pinTranscript: () => {}, rememberScroll: el => { distance.current = el.scrollHeight - el.clientHeight - el.scrollTop; },
      historyPaging: { hasMore: true, loadEarlier: before => new Promise<void>(resolve => {
        commit = () => { before?.(); setTurns(current => partial
          ? [[{ id: "prefix", role: "user", text: "Earlier" }, ...current[0]]]
          : [[{ id: "prefix", role: "user", text: "Earlier" }], ...current]); resolve(); };
      }) },
    });
    return createElement("div", { ref: (node: HTMLDivElement | null) => {
      ref.current = node; if (!node) return; scroller = node;
      Object.defineProperties(node, { clientHeight: { configurable: true, get: () => 50 },
        scrollHeight: { configurable: true, get: () => node.querySelectorAll("span").length * 100 } });
    } }, createElement("button", { onClick: paging.loadEarlier, disabled: paging.historyPending }, "Earlier"),
    ...paging.visibleTurns.map(turn => createElement("div", { key: turn[0].id, className: "transcript-turn" },
      ...turn.map(block => createElement("span", { key: block.id }, block.text)))));
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    scroller.scrollTop = 10;
    await act(async () => container.querySelector("button")!.click());
    // The reader can still scroll while the HTTP page is in flight.
    scroller.scrollTop = 35;
    await act(async () => commit());
    expect(scroller.scrollTop).toBe(135);
    expect(container.textContent).toContain("EarlierOld");
  } finally {
    act(() => root.unmount()); container.remove(); queryClient.clear(); vi.unstubAllGlobals();
  }
});
