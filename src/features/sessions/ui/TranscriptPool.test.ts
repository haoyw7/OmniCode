// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PooledTranscript,
  TranscriptPool,
  TranscriptPoolOutlet,
} from "./TranscriptPool";

let container: HTMLDivElement;
let root: Root;
let mounts: string[];
let unmounts: string[];

function Probe({
  id,
  visible,
  parked,
}: {
  id: string;
  visible?: boolean;
  parked?: boolean;
}) {
  const [instance] = useState(() => Math.random());
  useEffect(() => {
    mounts.push(id);
    return () => {
      unmounts.push(id);
    };
  }, [id]);
  return createElement("div", {
    "data-probe": id,
    "data-instance": instance,
    "data-visible": String(visible),
    "data-parked": String(!!parked),
  });
}

function render(pool: TranscriptPool, shown: string | null, onFocus = vi.fn()) {
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        shown
          ? createElement(
              "section",
              { key: shown, "data-pane": shown },
              createElement(
                PooledTranscript,
                { pool, sessionId: shown, onMouseDown: onFocus },
                createElement(Probe, { id: shown, visible: true }),
              ),
            )
          : null,
        createElement(TranscriptPoolOutlet, { pool }),
      ),
    ),
  );
}

function probe(id: string) {
  return document.querySelector<HTMLElement>(`[data-probe="${id}"]`);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mounts = [];
  unmounts = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("transcript pool", () => {
  it("mounts only the active restored transcript, retaining it after a tab switch", () => {
    const pool = new TranscriptPool();
    const ids = Array.from({ length: 39 }, (_, index) => `restored-${index}`);
    const show = (active: string) => {
      act(() =>
        root.render(
          createElement(
            "div",
            null,
            ...ids.map((id) =>
              createElement(
                "section",
                { key: id, hidden: id !== active, "data-pane": id },
                createElement(
                  PooledTranscript,
                  { pool, sessionId: id },
                  createElement(Probe, { id, visible: id === active }),
                ),
              ),
            ),
            createElement(TranscriptPoolOutlet, { pool }),
          ),
        ),
      );
    };

    show(ids[0]);
    const firstInstance = probe(ids[0])?.dataset.instance;
    expect(mounts).toEqual([ids[0]]);
    expect(pool.getSnapshot()).toHaveLength(1);

    show(ids[1]);
    expect(mounts).toEqual([ids[0], ids[1]]);
    expect(probe(ids[0])?.dataset.visible).toBe("false");
    expect(probe(ids[0])?.dataset.instance).toBe(firstInstance);
    expect(pool.getSnapshot()).toHaveLength(2);

    show(ids[0]);
    expect(probe(ids[0])?.dataset.instance).toBe(firstInstance);
    expect(mounts).toEqual([ids[0], ids[1]]);
    expect(unmounts).toEqual([]);
  });

  it("requires a first visit again when the pane's session or pool changes", () => {
    const firstPool = new TranscriptPool();
    const secondPool = new TranscriptPool();
    const show = (pool: TranscriptPool, id: string, visible: boolean) => {
      act(() =>
        root.render(
          createElement(
            "div",
            null,
            createElement(
              "section",
              { "data-pane": "same-host" },
              createElement(
                PooledTranscript,
                { pool, sessionId: id },
                createElement(Probe, { id, visible }),
              ),
            ),
            createElement(TranscriptPoolOutlet, { pool: firstPool }),
            createElement(TranscriptPoolOutlet, { pool: secondPool }),
          ),
        ),
      );
    };

    show(firstPool, "a", true);
    const firstInstance = probe("a")?.dataset.instance;
    show(firstPool, "b", false);
    expect(probe("a")).toBeNull();
    expect(probe("b")).toBeNull();
    expect(firstPool.getSnapshot().map((entry) => entry.id)).toEqual(["a"]);
    expect(firstPool.getSnapshot()[0].host).toBeNull();
    expect(mounts).toEqual(["a"]);

    show(firstPool, "a", false);
    expect(probe("a")).toBeNull();
    show(firstPool, "a", true);
    expect(probe("a")?.dataset.instance).toBe(firstInstance);

    show(secondPool, "a", false);
    expect(probe("a")).toBeNull();
    expect(secondPool.getSnapshot()).toEqual([]);
    expect(firstPool.getSnapshot()[0].host).toBeNull();
    show(secondPool, "a", true);
    expect(probe("a")?.dataset.instance).not.toBe(firstInstance);
    expect(mounts).toEqual(["a", "a"]);
    expect(unmounts).toEqual([]);
  });

  it("does not let a never-shown host take a transcript from its visible pane", () => {
    const pool = new TranscriptPool();
    const show = (secondVisible: boolean, firstPresent = true) => {
      act(() =>
        root.render(
          createElement(
            "div",
            null,
            ...["first", "second"].map((pane) =>
              pane === "first" && !firstPresent
                ? null
                : createElement(
                    "section",
                    { key: pane, "data-pane": pane },
                    createElement(
                      PooledTranscript,
                      { pool, sessionId: "a" },
                      createElement(Probe, {
                        id: "a",
                        visible: pane === "first" || secondVisible,
                      }),
                    ),
                  ),
            ),
            createElement(TranscriptPoolOutlet, { pool }),
          ),
        ),
      );
    };

    show(false);
    const instance = probe("a")?.dataset.instance;
    expect(probe("a")?.closest("section")?.dataset.pane).toBe("first");
    show(true);
    expect(probe("a")?.closest("section")?.dataset.pane).toBe("second");
    show(true, false);
    expect(probe("a")?.closest("section")?.dataset.pane).toBe("second");
    expect(probe("a")?.dataset.instance).toBe(instance);
    expect(mounts).toEqual(["a"]);
    expect(unmounts).toEqual([]);
  });

  it("cycles through ten chats without rebuilding any transcript", () => {
    const pool = new TranscriptPool();
    const ids = Array.from({ length: 10 }, (_, index) => `chat-${index}`);
    const instances = new Map<string, string | undefined>();
    for (const id of ids) {
      render(pool, id);
      instances.set(id, probe(id)?.dataset.instance);
    }
    for (const id of ids) {
      render(pool, id);
      expect(probe(id)?.dataset.instance).toBe(instances.get(id));
    }
    expect(mounts).toEqual(ids);
    expect(unmounts).toEqual([]);
  });

  it("shows the transcript inside the pane that hosts it", () => {
    const pool = new TranscriptPool();
    render(pool, "a");

    const shown = probe("a");
    expect(shown?.closest('[data-pane="a"]')).not.toBeNull();
    expect(shown?.dataset.visible).toBe("true");
  });

  it("keeps the snapshot stable when a pane supplies equivalent transcript props", () => {
    const pool = new TranscriptPool();
    const onFocus = vi.fn();
    render(pool, "a", onFocus);
    const instance = probe("a")?.dataset.instance;
    const snapshot = pool.getSnapshot();
    const changed = vi.fn();
    const unsubscribe = pool.subscribe(changed);
    for (let update = 0; update < 20; update++) render(pool, "a", onFocus);
    expect(changed).not.toHaveBeenCalled();
    expect(pool.getSnapshot()).toBe(snapshot);
    expect(probe("a")?.dataset.instance).toBe(instance);
    unsubscribe();
  });

  it("updates the portal's event handler when the pane supplies a new callback", () => {
    const pool = new TranscriptPool();
    const before = vi.fn();
    const after = vi.fn();
    render(pool, "a", before);
    render(pool, "a", after);
    act(() =>
      probe("a")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
    );
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledOnce();
  });

  it("delivers changed visibility props without remounting the transcript", () => {
    const pool = new TranscriptPool();
    render(pool, "a");
    const instance = probe("a")?.dataset.instance;
    const entry = pool.getSnapshot()[0];
    act(() =>
      pool.show(
        "a",
        entry.host!,
        createElement(Probe, { id: "a", visible: false }),
      ),
    );
    expect(probe("a")?.dataset.visible).toBe("false");
    expect(probe("a")?.dataset.instance).toBe(instance);
    expect(unmounts).toEqual([]);
  });

  it("reuses the mounted transcript when a session is shown again", () => {
    const pool = new TranscriptPool();
    render(pool, "a");
    const instance = probe("a")?.dataset.instance;

    render(pool, "b");
    expect(probe("a")).toBeNull();
    expect(unmounts).toEqual([]);

    render(pool, "a");
    expect(probe("a")?.dataset.instance).toBe(instance);
    expect(probe("a")?.closest('[data-pane="a"]')).not.toBeNull();
    expect(mounts).toEqual(["a", "b"]);
  });

  it("marks a parked transcript hidden until a pane shows it again", () => {
    const pool = new TranscriptPool();
    render(pool, "a");
    render(pool, null);

    const parked = pool.getSnapshot()[0];
    expect(parked.host).toBeNull();
    expect(parked.element.props).toMatchObject({
      visible: false,
      parked: true,
    });

    render(pool, "a");
    expect(probe("a")?.dataset.parked).toBe("false");
  });

  it("unmounts the least recently shown transcripts beyond the limit", () => {
    const pool = new TranscriptPool(2);
    for (const id of ["a", "b", "c", "d"]) render(pool, id);
    render(pool, null);

    expect(unmounts).toEqual(["a", "b"]);
    expect(pool.getSnapshot().map((entry) => entry.id)).toEqual(["c", "d"]);
  });

  it("forwards mouse down from the transcript to its pane", () => {
    const pool = new TranscriptPool();
    const onFocus = vi.fn();
    render(pool, "a", onFocus);

    act(() => {
      probe("a")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("ignores a park from a pane that no longer hosts the session", () => {
    const pool = new TranscriptPool();
    const stale = document.createElement("div");
    const host = document.createElement("div");
    const element = createElement(Probe, { id: "a" });
    pool.show("a", stale, element);
    pool.show("a", host, element);

    pool.park("a", stale);
    expect(pool.getSnapshot()[0].host).toBe(host);
    expect(host.childElementCount).toBe(1);
  });

  it("renders in place without a pool", () => {
    act(() =>
      root.render(
        createElement(
          PooledTranscript,
          { sessionId: "a" },
          createElement(Probe, { id: "a", visible: true }),
        ),
      ),
    );
    expect(probe("a")?.parentElement).toBe(container);
  });
});
