// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../features/sessions/model/session";
import type { HostSession } from "../features/connections/model/protocol";
import { MobileFileSheet } from "./MobileFileSheet";
import { MobileTranscript } from "./MobileTranscript";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// A portable regression for the reported tool -> View file flow. No private
// snapshot, absolute checkout path or scratchpad file is needed to run it.
describe("mobile file preview and tool navigation", () => {
  let root: Root;
  let app: HTMLDivElement;
  let uncaught: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    app = document.createElement("div");
    app.className = "mobile-app";
    document.body.append(app);
    uncaught = vi.fn();
    root = createRoot(app, { onUncaughtError: uncaught });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    app.remove();
    vi.unstubAllGlobals();
  });

  async function renderFile(
    path: string,
    readBinaryFile: (path: string) => Promise<Uint8Array>,
    line?: number,
  ) {
    await act(async () =>
      root.render(
        createElement(MobileFileSheet, {
          path,
          line,
          cwd: "/repo",
          readBinaryFile,
          onClose: () => {},
        }),
      ),
    );
  }

  it("opens highlighted source without unmounting the conversation, then goes back to the tool", async () => {
    const session = newSession("claude", "/repo");
    session.blocks = [
      { id: "user", role: "user", text: "Test tools" },
      {
        id: "read",
        role: "tool",
        text: "Read package.json",
        tool: {
          kind: "read",
          status: "completed",
          detail: '1\t{\n2\t  "name": "example"',
          preview: { kind: "read", path: "/repo/package.json" },
        },
      },
    ];
    const snapshot: HostSession = {
      session,
      projectId: "project",
      revision: 1,
      status: "running",
      updatedAt: 1,
    };
    const readBinaryFile = vi.fn(async () =>
      new TextEncoder().encode('{"name":"example", "last":"complete file"}\n'),
    );
    await act(async () =>
      root.render(
        createElement(MobileTranscript, {
          snapshot,
          disabled: false,
          onCommand: () => {},
          readBinaryFile,
        }),
      ),
    );
    const row = app.querySelector<HTMLElement>("[data-tool-open-row]");
    expect(row).not.toBeNull();
    await act(async () => row!.click());
    await act(async () => vi.dynamicImportSettled());
    expect(app.querySelector(".mobile-tool-sheet h3")?.textContent).toBe(
      "Output",
    );
    expect(app.querySelector(".mobile-tool-sheet pre")?.textContent).toContain(
      '"name": "example"',
    );
    const view = [...app.querySelectorAll("button")].find(
      (b) => b.textContent === "View file",
    );
    expect(view).toBeDefined();
    await act(async () => view!.click());
    await act(async () => vi.dynamicImportSettled());
    expect(readBinaryFile).toHaveBeenCalledWith("/repo/package.json");
    expect(app.querySelector(".mobile-file-sheet")?.textContent).toContain(
      "complete file",
    );
    expect(app.querySelector('[role="log"]')?.textContent).toContain(
      "Test tools",
    );
    const back = app.querySelector<HTMLButtonElement>(
      'button[aria-label="Back"]',
    );
    expect(back).not.toBeNull();
    await act(async () => back!.click());
    expect(app.querySelector(".mobile-tool-sheet")).not.toBeNull();
    const closingFile = app.querySelector(".mobile-file-sheet")!.closest(".mobile-sheet-backdrop")!;
    expect(closingFile.getAttribute("data-fold-state")).toBe("closing");
    expect(closingFile.hasAttribute("inert")).toBe(true);
    await act(async () => closingFile.dispatchEvent(new Event("animationend", { bubbles: true })));
    expect(app.querySelector(".mobile-file-sheet")).toBeNull();
    await act(async () =>
      app
        .querySelector('[role="dialog"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    const closingTool = app.querySelector(".mobile-tool-sheet")!.closest(".mobile-sheet-backdrop")!;
    expect(closingTool.hasAttribute("inert")).toBe(true);
    await act(async () => closingTool.dispatchEvent(new Event("animationend", { bubbles: true })));
    expect(app.querySelector('[role="dialog"]')).toBeNull();
    expect(uncaught).not.toHaveBeenCalled();
  });

  it("loads a new file into the existing sheet instead of showing stale text", async () => {
    const read = vi.fn(async (path: string) =>
      new TextEncoder().encode(
        path.endsWith("first.txt") ? "first file" : "second file",
      ),
    );
    await renderFile("/repo/first.txt", read);
    expect(app.querySelector(".mobile-file-sheet")?.textContent).toContain(
      "first file",
    );
    await renderFile("/repo/second.txt", read);
    expect(app.querySelector(".mobile-file-sheet")?.textContent).toContain(
      "second file",
    );
    expect(app.querySelector(".mobile-file-sheet")?.textContent).not.toContain(
      "first file",
    );
    expect(uncaught).not.toHaveBeenCalled();
  });

  it("hides portalled details when the conversation leaves without remounting its transcript", async () => {
    const session = newSession("claude", "/repo");
    session.blocks = [
      { id: "user", role: "user", text: "Read files" },
      { id: "read", role: "tool", text: "Read package.json",
        tool: { kind: "read", status: "completed", detail: "File contents",
          preview: { kind: "read", path: "/repo/package.json" } } },
    ];
    const snapshot: HostSession = { session, projectId: "project", revision: 1,
      status: "idle", updatedAt: 1 };
    const render = async (active: boolean) => act(async () => root.render(
      createElement(MobileTranscript, { snapshot, active, disabled: false, onCommand: () => {} }),
    ));
    await render(true);
    const transcript = app.querySelector(".agent-transcript");
    await act(async () => app.querySelector<HTMLElement>("[data-tool-open-row]")!.click());
    expect(app.querySelector('[role="dialog"]')).not.toBeNull();
    await render(false);
    expect(app.querySelector('[role="dialog"]')).toBeNull();
    expect(app.querySelector('[role="log"]')!.hasAttribute("inert")).toBe(true);
    expect(app.querySelector(".agent-transcript")).toBe(transcript);
    await render(true);
    expect(app.querySelector('[role="dialog"]')).toBeNull();
    expect(app.querySelector(".agent-transcript")).toBe(transcript);
  });

  it("shows a read error without crashing", async () => {
    await renderFile("/repo/missing.txt", async () => {
      throw new Error("File not found");
    });
    expect(app.querySelector('[role="alert"]')?.textContent).toContain(
      "File not found",
    );
    expect(app.querySelector('[role="dialog"]')).not.toBeNull();
    expect(uncaught).not.toHaveBeenCalled();
  });

  it("keeps numbered plain text for cited lines", async () => {
    await renderFile(
      "/repo/app.ts",
      async () => new TextEncoder().encode("first\nsecond\nthird"),
      2,
    );
    expect(
      app.querySelector('[data-current="true"]')?.getAttribute("data-line"),
    ).toBe("2");
    expect(app.querySelector('[data-current="true"]')?.textContent).toBe(
      "second\n",
    );
    expect(uncaught).not.toHaveBeenCalled();
  });

  it("virtualizes long files and opens the cited line without mounting preceding lines", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const total = 1200;
    const text = Array.from({ length: total }, (_, i) => `line ${i + 1}`).join("\n");
    const cited = 610;
    await act(async () => { await import("../shared/ui/ReadonlyTextEditor"); });
    await renderFile("/repo/big.log", async () => new TextEncoder().encode(text), cited);
    await vi.waitFor(async () => { await act(async () => {}); expect(app.querySelector(".cm-editor")).not.toBeNull(); });
    const view = EditorView.findFromDOM(app.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(view.state.doc.toString()).toBe(text);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(cited);
    expect(app.querySelectorAll(".cm-line").length).toBeLessThan(100);
    expect(app.textContent).not.toContain("more lines");
    expect(uncaught).not.toHaveBeenCalled();
  });
});
