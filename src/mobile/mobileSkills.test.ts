// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileComposer, type MobileComposerPanel } from "./MobileComposer";
import type { HostSkillCatalog } from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";

const catalog: HostSkillCatalog = {
  native: false,
  canCompact: true,
  skills: [
    {
      kind: "file",
      name: "review",
      invocation: "review",
      description: "Review 中文 rules",
      scope: "project",
      source: "agents",
      path: "/repo/.agents/skills/review/SKILL.md",
    },
    {
      kind: "file",
      name: "lint",
      invocation: "lint",
      description: "Check style",
      scope: "user",
      source: "agents",
      path: "/home/me/.agents/skills/lint/SKILL.md",
    },
  ],
};
let node: HTMLDivElement, root: Root;
let load: ReturnType<
  typeof vi.fn<(refresh?: boolean) => Promise<HostSkillCatalog>>
>;
let onSend: ReturnType<typeof vi.fn>;
let overrides: Record<string, any>;
let context = 0;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  load = vi.fn(async () => catalog);
  onSend = vi.fn();
  overrides = { skillsContextKey: `codex:project:${++context}` };
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  setUiLanguage("en");
  vi.unstubAllGlobals();
});
function Fixture() {
  const [text, setText] = useState("");
  const [panel, setPanel] = useState<MobileComposerPanel>(null);
  return createElement(MobileComposer, {
    value: text,
    onChange: setText,
    configuration: {
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
    },
    catalog: { models: {}, errors: {} },
    onConfigurationChange: vi.fn(),
    lockedAgent: false,
    disabled: false,
    running: false,
    canSend: !!text,
    canStop: false,
    working: false,
    onSend,
    onStop: vi.fn(),
    panel,
    onPanelChange: setPanel,
    project: { id: "project", name: "Project", cwd: "/repo" },
    projects: [],
    onProjectChange: vi.fn(),
    attachments: [],
    onFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    planMode: false,
    onPlanModeChange: vi.fn(),
    skillsContextKey: "codex:project",
    loadSkills: load,
    canCompact: true,
    ...overrides,
  });
}
async function render(next: Record<string, any> = {}) {
  overrides = { ...overrides, ...next };
  await act(async () => root.render(createElement(Fixture)));
}
function area() {
  return node.querySelector<HTMLTextAreaElement>("textarea")!;
}
async function input(value: string, cursor = value.length) {
  await act(async () => {
    const field = area();
    field.focus();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.setSelectionRange(cursor, cursor);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(name: string) {
  const element = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name,
  );
  expect(element, `button ${name}`).toBeDefined();
  return element!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
function option(invocation: string) {
  return [...node.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (item) => item.querySelector("strong")?.textContent === `/${invocation}`,
  )!;
}
async function choose(invocation: string) {
  const item = option(invocation);
  expect(item).toBeDefined();
  await act(async () => item.click());
  await act(
    async () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("mobile skills and slash completion", () => {
  it("loads only on demand, lists skills in the plus menu and inserts without sending", async () => {
    await render();
    expect(load).not.toHaveBeenCalled();
    await input("Before after", 7);
    await click("Add to message");
    expect(node.querySelector(".mobile-composer-skills")).toBeNull();
    expect(node.querySelector(".mobile-composer-project")).toBeNull();
    expect(option("review")).toBeDefined();
    expect(load).toHaveBeenCalledWith(true);
    expect(node.querySelector('.mobile-skill-picker input, .mobile-skill-picker h2')).toBeNull();
    expect(option("lint")).toBeDefined();
    await choose("review");
    expect(area().value).toBe("Before /review after");
    expect(area().selectionStart).toBe(15);
    expect(document.activeElement).toBe(area());
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("reuses slash completion at the caret and supports hardware-keyboard selection and Escape", async () => {
    await render();
    await input("Use /rev later", 8);
    expect(node.querySelector(".mobile-command-suggestions")).not.toBeNull();
    expect(option("review")).toBeDefined();
    await act(async () =>
      area().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await act(
      async () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    expect(area().value).toBe("Use /review later");
    expect(onSend).not.toHaveBeenCalled();
    await input("/");
    await act(async () =>
      area().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(node.querySelector(".mobile-command-suggestions")).toBeNull();
    expect(area().value).toBe("/");
  });

  it.each(["pi", "omp"])("keeps %s native invocations, aliases, hints and arguments exact", async (harness) => {
    const native = {
      native: true,
      canCompact: true,
      skills: [
        {
          kind: "native" as const,
          source: harness as "pi" | "omp",
          name: "audit",
          invocation: "skill:audit",
          description: "Native 中文",
          aliases: ["review"],
          inputHint: "<path>",
        },
      ],
    };
    load.mockResolvedValue(native);
    await render({
      configuration: {
        harness,
        model: `${harness}:test`,
        modelSettings: {},
        runtimeMode: "supervised",
      },
      skillsContextKey: `${harness}:project:${context}`,
    });
    await input("/review @raw", 7);
    expect(load).toHaveBeenCalledWith(false);
    expect(node.textContent).toContain("<path>");
    await choose("skill:audit");
    expect(area().value).toBe("/skill:audit @raw");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("retries a failed catalog without changing the draft", async () => {
    load.mockRejectedValueOnce(new Error("Host offline"));
    await render();
    await input("/rev");
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      "Host offline",
    );
    expect(area().value).toBe("/rev");
    await click("Retry");
    expect(option("review")).toBeDefined();
    expect(area().value).toBe("/rev");
  });

  it("reopens the add menu with cached skills and still toggles plan mode", async () => {
    const onPlanModeChange = vi.fn();
    await render({ onPlanModeChange });
    await click("Add to message");
    expect(option("review")).toBeDefined();
    const closeMenu = async () => act(async () => {
      node.querySelector('[role="dialog"]')!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await closeMenu();
    // An unresolved second response would have shown loading on every reopen.
    load.mockReturnValue(deferred<HostSkillCatalog>().promise);
    await click("Add to message");
    expect(load).toHaveBeenCalledOnce();
    expect(option("review")).toBeDefined();
    expect(node.querySelector('.mobile-skill-picker [role="status"]')).toBeNull();
    await act(async () => node.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(onPlanModeChange).toHaveBeenCalledWith(true);
    expect(area().value).toBe("");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("hides a previous context immediately and ignores its late catalog", async () => {
    const pending = deferred<HostSkillCatalog>();
    load.mockReturnValueOnce(pending.promise);
    await render();
    await input("/rev");
    const next = vi.fn(async () => ({
      native: false,
      canCompact: false,
      skills: [],
    }));
    await render({ skillsContextKey: "codex:other", loadSkills: next });
    await act(async () => pending.resolve(catalog));
    expect(option("review")).toBeUndefined();
    expect(area().value).toBe("/rev");
    await input("/");
    expect(next).toHaveBeenCalled();
    expect(option("review")).toBeUndefined();
    expect(option("compact")).toBeUndefined();
  });

  it("switches application labels live while preserving user/provider descriptions and the draft", async () => {
    await render();
    await input("/review");
    act(() => setUiLanguage("zh-CN"));
    expect(node.textContent).toContain("技能与命令");
    expect(node.textContent).toContain("Review 中文 rules");
    expect(area().value).toBe("/review");
  });
});
