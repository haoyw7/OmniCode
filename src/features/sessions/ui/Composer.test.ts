// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpInvoke = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/wsl", () => ({
  listWslDistributions: vi.fn().mockResolvedValue(["Ubuntu", "Debian"]),
  pickWslFolder: vi.fn(),
}));
vi.mock("../../../shared/ui/StatusToast", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../shared/ui/StatusToast")>(),
  showStatusToast: vi.fn(),
}));
import { pickWslFolder } from "../../../platform/tauri/wsl";
import { showStatusToast } from "../../../shared/ui/StatusToast";
vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...original,
    invoke: (command: string, args?: unknown) =>
      command === "mcp_discover" || command === "claude_mcp_list" || command === "pi_mcp_list"
        ? mcpInvoke(command, args)
        : original.invoke(command, args),
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: vi.fn(() => ({
    branches: {
      current: "mc/greeting",
      detached: false,
      branches: [
        { name: "mc/greeting", remote: null, current: true },
        { name: "main", remote: null, current: false },
      ],
    },
    settled: true,
  })),
}));
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";

vi.mock("../../source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: (_cwd: string, enabled = true) => ({
    data: enabled ? {
      defaultRoot: "/repo-worktrees",
      worktrees: [
        { path: "/repo", isMain: true, missing: false },
        { path: "/repo-worktrees/feature", isMain: false, missing: false },
        { path: "/repo-worktrees/mc-greeting", isMain: false, missing: false },
        { path: "/repo-worktrees/mc-3f2a1b7c", isMain: false, missing: false },
      ],
    } : undefined,
    refresh: async () => true,
  }),
}));

import { Composer } from "./Composer";
import { ComposerAction } from "./ComposerAction";
import { startWorktreeCreation } from "../../source-control/model/worktreeCreation";
import {
  clearMcpSettingsCache,
  loadMcpSettings,
} from "../../settings/model/mcpSettingsCache";
import type { ComposerTurnOptions, Attachment } from "../model/session";
import {
  clearComposerDraft,
  getComposerDraft,
  setComposerDraft,
  stashComposerAttachments,
} from "../model/draftCache";
import type { UserQuestionPrompt } from "../model/userQuestion";

function renderAction(
  busy: boolean,
  hasValue: boolean,
  allowBusySubmit = true,
) {
  return renderToStaticMarkup(
    createElement(ComposerAction, {
      busy,
      hasValue,
      allowBusySubmit,
      onSend: vi.fn(),
      onStop: vi.fn(),
    }),
  );
}

describe("ComposerAction", () => {
  it("replaces Stop with Send when typing during a running turn", () => {
    const empty = renderAction(true, false);
    expect(empty).toContain('aria-label="Stop"');
    expect(empty).not.toContain('aria-label="Send"');

    const typed = renderAction(true, true);
    expect(typed).toContain('aria-label="Send"');
    expect(typed).toContain("composer-send");
    expect(typed).toContain("primary-action");
    expect(typed).not.toContain('aria-label="Stop"');
  });

  it("keeps Stop while busy when submitting follow-up text is disabled", () => {
    const typed = renderAction(true, true, false);
    expect(typed).toContain('aria-label="Stop"');
    expect(typed).not.toContain('aria-label="Send"');
  });
});

describe("Composer question focus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearMcpSettingsCache();
    mcpInvoke.mockReset();
    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? [
            {
              provider: "claude",
              name: "docs",
              scope: "project",
              configPath: "/repo/.mcp.json",
              transport: "stdio",
            },
            {
              provider: "cursor",
              name: "other",
              scope: "user",
              configPath: "/cursor/mcp.json",
              transport: "stdio",
            },
          ]
        : command === "claude_mcp_list"
          ? "docs: local - ✔ Connected"
          : undefined,
    );
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const question: UserQuestionPrompt = {
    requestId: 1,
    questions: [
      {
        id: "q1",
        prompt: "Pick one",
        multiSelect: false,
        allowCustom: false,
        options: [{ id: "a", label: "Option A" }],
      },
    ],
  };

  it("opens the environment picker from the workspace bar without disturbing the draft", async () => {
    const onSubmit = vi.fn();
    await renderComposer(undefined, vi.fn(), false, 0, "Keep my draft", undefined, onSubmit);
    const trigger = container.querySelector<HTMLButtonElement>(".composer-environment-badge")!;
    expect(trigger.tagName).toBe("BUTTON");
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[aria-label="Environment options"]')).not.toBeNull();
    expect(container.querySelector("textarea")!.value).toBe("Keep my draft");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("selects WSL without opening folders, then chooses a WSL project separately while retaining the draft", async () => {
    clearComposerDraft("environment-draft");
    vi.mocked(pickWslFolder).mockReset().mockResolvedValue(null);
    vi.mocked(showStatusToast).mockClear();
    const onCwdChange = vi.fn();
    const onSubmit = vi.fn();
    const props = {
      sessionId: "environment-draft", focused: true, harness: "claude" as const,
      model: "claude-sonnet", runtimeMode: "supervised" as const,
      cwd: "C:/code/app", executionCwd: "C:/code/app", initialDraft: "Keep my draft",
      recents: [{ path: "C:/code/other" }, { path: "wsl://Ubuntu/home/ubuntu" }, { path: "wsl://Debian/home/dev" }],
      onFocus: vi.fn(), onCwdChange, onModelChange: vi.fn(), onRuntimeModeChange: vi.fn(), onSubmit,
    };
    await act(async () => root.render(createElement(Composer, props)));
    const option = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find(node => node.textContent?.startsWith(label))!;
    const environment = container.querySelector<HTMLButtonElement>(".composer-environment-badge")!;
    await act(async () => environment.click());
    await act(async () => option("WSL").click());
    await act(async () => option("Debian").click());
    expect(environment.textContent).toBe("WSL · Debian");
    expect(pickWslFolder).not.toHaveBeenCalled();
    expect(onCwdChange).not.toHaveBeenCalled();
    const input = container.querySelector("textarea")!;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe("Keep my draft");
    expect(showStatusToast).toHaveBeenCalledWith("Choose a project folder in the selected environment before sending.", "error");
    const project = container.querySelector<HTMLButtonElement>('.composer-project-picker button[aria-haspopup="menu"]')!;
    expect(project.textContent).toContain("Choose project");
    await act(async () => project.click());
    const menu = document.querySelector('[aria-label="Project picker"]')!;
    expect(menu.textContent).toContain("dev");
    expect(menu.textContent).not.toContain("ubuntu");
    expect(menu.textContent).not.toContain("other");
    const openFolder = () => [...document.querySelectorAll<HTMLButtonElement>('[data-cwd-picker] button')]
      .find(node => node.textContent === "Open folder…" && !node.closest('[inert]'))!;
    await act(async () => openFolder().click());
    expect(pickWslFolder).toHaveBeenCalledWith("Debian", "Open a WSL project");
    expect(onCwdChange).not.toHaveBeenCalled();
    expect(environment.textContent).toBe("WSL · Debian");
    vi.mocked(pickWslFolder).mockResolvedValueOnce("/home/dev");
    await act(async () => project.click());
    await act(async () => openFolder().click());
    expect(onCwdChange).toHaveBeenCalledWith("wsl://Debian/home/dev");
    await act(async () => root.render(createElement(Composer, { ...props, cwd: "wsl://Debian/home/dev", executionCwd: "wsl://Debian/home/dev" })));
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSubmit).toHaveBeenCalledWith("Keep my draft", [], expect.any(Object));
    clearComposerDraft("environment-draft");
  });

  it("fills a plain prompt into the composer without saving or sending it", async () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();
    const onDraftChange = vi.fn();
    const onQuoteRequestConsumed = vi.fn();
    const props = {
      focused: true,
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      executionCwd: "/repo",
      initialDraft: "My requirements",
      hideProjectPicker: true,
      hideBranchPicker: true,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit,
      onSaveDraft,
      onDraftChange,
      onQuoteRequestConsumed,
    };
    await act(async () => root.render(createElement(Composer, props)));
    await act(async () => root.render(createElement(Composer, {
      ...props,
      quoteRequest: { id: 1, text: "Help me design a workflow", mode: "plain" },
    })));
    const input = container.querySelector("textarea")!;
    expect(input.value).toBe("My requirements\n\nHelp me design a workflow\n\n");
    expect(document.activeElement).toBe(input);
    expect(onDraftChange).toHaveBeenLastCalledWith(input.value);
    expect(onQuoteRequestConsumed).toHaveBeenCalledWith(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("keeps a typed draft while external native ownership disables sending, then resumes after unlock", async () => {
    const submit = vi.fn();
    const props = { focused: true, harness: "codex" as const, model: "codex:gpt-5.4", runtimeMode: "supervised" as const, executionCwd: "/repo", initialDraft: "continue after the external task", hideProjectPicker: true, hideBranchPicker: true, onFocus: vi.fn(), onCwdChange: vi.fn(), onModelChange: vi.fn(), onRuntimeModeChange: vi.fn(), onSubmit: submit };
    await act(async () => root.render(createElement(Composer, { ...props, disabled: true, readOnlyReason: "External session is open" })));
    const input = container.querySelector("textarea")!;
    expect(input.value).toBe(props.initialDraft);
    expect(input.disabled).toBe(true);
    expect(container.querySelector('[data-native-readonly="true"]')).not.toBeNull();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(submit).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Composer, { ...props, disabled: false })));
    expect(input.value).toBe(props.initialDraft);
    expect(input.disabled).toBe(false);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(submit).toHaveBeenCalledWith(props.initialDraft, [], expect.any(Object));
  });

  async function renderComposer(
    currentQuestion: UserQuestionPrompt | undefined,
    onQuestionReply: (requestId: number, reply: unknown) => void,
    busy = false,
    focusToken = 0,
    initialDraft?: string,
    onBtwCommand?: (
      text: string,
      options?: { draft?: boolean },
    ) => boolean | void,
    onSubmit: (text: string, attachments: Attachment[]) => void = () => {},
    sessionId?: string,
    harness: "claude" | "codex" | "pi" = "claude",
  ) {
    await act(async () =>
      root.render(
        createElement(Composer, {
          key: sessionId,
          focused: true,
          focusToken,
          harness,
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft,
          sessionId,
          onDraftChange: sessionId
            ? (text) => setComposerDraft(sessionId, text)
            : undefined,
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: () => {},
          onCwdChange: () => {},
          onModelChange: () => {},
          onRuntimeModeChange: () => {},
          onSubmit,
          onBtwCommand,
          question: currentQuestion,
          onQuestionReply,
          busy,
        }),
      ),
    );
  }

    it.each([
      ["Files", "@", "[data-mention-picker]"],
      ["Skills and commands", "/", "[data-skill-picker]"],
    ])("opens %s from the + menu at the selected draft range", async (label, trigger, picker) => {
      await renderComposer(undefined, vi.fn(), false, 0, "Review target");
      const input = container.querySelector("textarea")!;
      input.setSelectionRange(7, 13);
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Add files or choose a mode"]')!.click());
      const menu = document.querySelector<HTMLElement>("[data-composer-plus]")!;
      const item = [...menu.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.startsWith(label))!;
      await act(async () => item.click());
      expect(input.value).toBe(`Review ${trigger}`);
      expect(input.selectionStart).toBe(input.value.length);
      expect(document.activeElement).toBe(input);
      expect(document.querySelector(picker)).not.toBeNull();
      expect(menu.inert).toBe(true);
      expect(container.querySelector('[aria-label="Add files or choose a mode"]')?.getAttribute("aria-expanded")).toBe("false");
    });

    it("opens the existing MCP picker from the + menu without replacing draft text", async () => {
      await renderComposer(undefined, vi.fn(), false, 0, "Keep this draft");
      const plus = container.querySelector<HTMLButtonElement>('[aria-label="Add files or choose a mode"]')!;
      expect(plus.classList.contains("composer-plus")).toBe(true);
      await act(async () => plus.click());
      const item = [...document.querySelectorAll<HTMLButtonElement>("[data-composer-plus] button")].find((button) => button.textContent === "MCP servers")!;
      await act(async () => item.click());
      expect(container.querySelector("textarea")!.value).toBe("Keep this draft");
      expect(document.querySelector('[aria-label="Search MCP servers"]')).not.toBeNull();
    });

  it("keeps desktop permission controls below the card without replacing the draft or picker", async () => {
    const compact = false;
    const onRuntimeModeChange = vi.fn();
    const props = {
      focused: true, harness: "claude" as const, model: "claude-sonnet",
      runtimeMode: "supervised" as const, executionCwd: "/repo", compact,
      initialDraft: "Preserve this draft", hideProjectPicker: true, hideBranchPicker: true,
      onFocus: vi.fn(), onCwdChange: vi.fn(), onModelChange: vi.fn(), onRuntimeModeChange,
      onSubmit: vi.fn(),
    };
    await act(async () => root.render(createElement(Composer, props)));
    const field = container.querySelector("textarea")!;
    const permission = container.querySelector<HTMLButtonElement>("[data-access-picker-trigger]")!;
    expect(Boolean(permission.closest('[data-ui="message-input"]'))).toBe(compact);
    expect(Boolean(permission.closest(".composer-meta"))).toBe(!compact);
    expect(container.querySelectorAll("[data-access-picker-trigger]")).toHaveLength(1);
    await act(async () => permission.click());
    expect(document.querySelector("[data-access-picker]")).not.toBeNull();
    await act(async () => root.render(createElement(Composer, { ...props, busy: true })));
    expect(container.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("Preserve this draft");
    expect(container.querySelector("[data-access-picker-trigger]")).toBe(permission);
  });

  it("retains the draft and model controls when switching desktop modes", async () => {
    const rootElement = document.documentElement;
    rootElement.dataset.desktopMode = "chat";
    const height = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
      .mockReturnValue(22);
    try {
      await renderComposer(undefined, vi.fn(), false, 0, "Retained across modes");
      const field = container.querySelector("textarea")!;
      const model = container.querySelector("[data-model-picker-trigger]")!;
      expect(model.closest(".composer-meta")).not.toBeNull();
      expect(model.closest('[data-ui="message-input"]')).toBeNull();
      await act(async () => { rootElement.dataset.desktopMode = "code"; });
      expect(container.querySelector("textarea")).toBe(field);
      expect(field.value).toBe("Retained across modes");
      expect(container.querySelector("[data-model-picker-trigger]")).toBe(model);
      expect(field.style.height).toBe("22px");
    } finally {
      delete rootElement.dataset.desktopMode;
      height.mockRestore();
    }
  });

  it.each([
    { compact: false, hidePickers: false },
    { compact: false, hidePickers: true },
    { compact: true, hidePickers: false },
    { compact: true, hidePickers: true },
  ])("keeps context actions beside desktop models or in the compact workspace bar (compact=$compact, hidePickers=$hidePickers)", async ({ compact, hidePickers }) => {
    const onCompactContext = vi.fn();
    const props = {
      focused: true,
      harness: "codex" as const,
      model: "codex:gpt-5.4",
      runtimeMode: "supervised" as const,
      executionCwd: "/repo",
      compact,
      hideProjectPicker: hidePickers,
      hideBranchPicker: hidePickers,
      context: { used: 1000, window: 10000 },
      compactSupported: true,
      onCompactContext,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    await act(async () => root.render(createElement(Composer, props)));
    const meters = container.querySelectorAll<HTMLButtonElement>('button[title="Context usage"]');
    expect(meters).toHaveLength(1);
    const meter = meters[0];
    const workspaceBar = container.querySelector(".composer-workspace-bar")!;
    expect(workspaceBar.contains(meter)).toBe(compact);
    expect(Boolean(meter.closest(".composer-meta"))).toBe(!compact);
    expect(meter.closest(".composer-footer")).toBeNull();
    await act(async () => meter.click());
    const compactAction = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => !button.closest("[inert]") && button.textContent === "Compact now")!;
    await act(async () => compactAction().click());
    expect(onCompactContext).toHaveBeenCalledOnce();

    await act(async () => root.render(createElement(Composer, { ...props, busy: true })));
    await act(async () => meter.click());
    expect(compactAction().disabled).toBe(true);
    await act(async () => compactAction().click());
    expect(onCompactContext).toHaveBeenCalledOnce();
  });

  it.each([false, true])("hides context with the workspace bar when hideTopBar is set (compact=%s)", async (compact) => {
    await act(async () => root.render(createElement(Composer, {
      focused: true, harness: "codex", model: "codex:gpt-5.4", runtimeMode: "supervised", executionCwd: "/repo", hideTopBar: true, compact,
      context: { used: 1000, window: 10000 }, compactSupported: true, onCompactContext: vi.fn(),
      onFocus: vi.fn(), onCwdChange: vi.fn(), onModelChange: vi.fn(), onRuntimeModeChange: vi.fn(), onSubmit: vi.fn(),
    })));
    expect(container.querySelector(".composer-workspace-bar")).toBeNull();
    expect(container.querySelector('button[title="Context usage"]')).toBeNull();
  });

  it.each([
    ["/btw", ""],
    ["/btw some text here...", "some text here..."],
  ])("routes %s to BTW instead of the main submit", async (draft, text) => {
    const onBtwCommand = vi.fn(() => true);
    const onSubmit = vi.fn();
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      draft,
      onBtwCommand,
      onSubmit,
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onBtwCommand).toHaveBeenCalledWith(text);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  async function typeInto(textarea: HTMLTextAreaElement, value: string) {
    await act(async () => {
      textarea.value = value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("does not offer or intercept the removed sidebar folder command", async () => {
    const onSubmit = vi.fn();
    await renderComposer(undefined, vi.fn(), false, 0, undefined, undefined, onSubmit);
    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "/");
    expect(container.textContent).not.toContain("/add-to-folder");
    await typeInto(textarea, "/add-to-folder keep this text");
    await act(async () => textarea.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true,
    })));
    expect(onSubmit).toHaveBeenCalledWith("/add-to-folder keep this text", [], expect.any(Object));
  });

  it("opens BTW as soon as `/btw ` is typed and hands over the rest", async () => {
    const onBtwCommand = vi.fn(() => true);
    await renderComposer(undefined, vi.fn(), false, 0, undefined, onBtwCommand);
    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "/btw");
    expect(onBtwCommand).not.toHaveBeenCalled();

    await typeInto(textarea, "/btw why");
    expect(onBtwCommand).toHaveBeenCalledWith("why", { draft: true });
    expect(textarea.value).toBe("");
  });

  it("leaves a typed `/btw ` alone when BTW is unavailable", async () => {
    const onBtwCommand = vi.fn(() => false);
    await renderComposer(undefined, vi.fn(), false, 0, undefined, onBtwCommand);
    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "/btw ");
    expect(textarea.value).toBe("/btw ");
  });

  it("opens a searchable MCP picker and sends selected context", async () => {
    const onSubmit = vi.fn();
    const onOpen = vi.fn();
    window.addEventListener("monocode:open-mcp-settings", onOpen);
    try {
      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        "/mcp",
        undefined,
        onSubmit,
      );
      const textarea = container.querySelector("textarea")!;
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(container.querySelector("[data-mcp-picker]")).not.toBeNull();
      expect(container.textContent).toContain("docs");
      expect(container.textContent).toContain("other");
      const unavailable = [
        ...container.querySelectorAll<HTMLButtonElement>(
          '[data-mcp-picker] [role="option"]',
        ),
      ].find((button) => button.textContent?.includes("other"))!;
      expect(unavailable.disabled).toBe(true);
      const search = container.querySelector<HTMLInputElement>(
        '[aria-label="Search MCP servers"]',
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(search, "docs");
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(
        container.querySelector("[data-mcp-picker]")?.textContent,
      ).not.toContain("other");
      const available = [
        ...container.querySelectorAll<HTMLButtonElement>(
          '[data-mcp-picker] [role="option"]',
        ),
      ].find((button) => button.textContent?.includes("docs"))!;
      await act(async () => available.click());
      expect(textarea.value).toBe("@mcp/docs ");
      expect(
        container.querySelector('[data-mcp-tag="@mcp/docs"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label="Selected MCP context"]'),
      ).toBeNull();
      await typeInto(textarea, `${textarea.value}Find the docs`);
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(onSubmit).toHaveBeenCalledWith(
        expect.stringContaining('"docs" (claude)'),
        expect.any(Array),
        expect.any(Object),
      );
      expect(container.querySelector('[data-mcp-tag="@mcp/docs"]')).toBeNull();
      expect(onOpen).not.toHaveBeenCalled();
      expect(textarea.value).toBe("");
    } finally {
      window.removeEventListener("monocode:open-mcp-settings", onOpen);
    }
  });

  it("reuses MCP discovery on reopen and applies shared settings refreshes", async () => {
    await renderComposer(undefined, vi.fn(), false, 0, "/mcp");
    const textarea = container.querySelector("textarea")!;
    const enter = () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    await act(async () => enter());
    expect(mcpInvoke).toHaveBeenCalledTimes(2);
    await act(async () =>
      container
        .querySelector('[aria-label="Search MCP servers"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    await typeInto(textarea, "/mcp");
    await act(async () => enter());
    expect(container.querySelector("[data-mcp-picker]")).not.toBeNull();
    expect(mcpInvoke).toHaveBeenCalledTimes(2);

    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? [
            {
              provider: "claude",
              name: "docs",
              scope: "project",
              configPath: "/repo/.mcp.json",
              transport: "stdio",
              enabled: false,
            },
          ]
        : "docs: local - Connected",
    );
    await act(async () => {
      await loadMcpSettings("/repo", true);
    });
    const docs = container.querySelector<HTMLButtonElement>(
      '[data-mcp-picker] [role="option"]',
    )!;
    expect(docs.disabled).toBe(true);
    expect(docs.textContent).toContain("Disabled in provider configuration");
    expect(mcpInvoke).toHaveBeenCalledTimes(4);
  });

  it("loads Pi native health and disables servers that require sign-in or failed", async () => {
    let state = "connected";
    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? ["docs", "auth", "failed"].map((name) => ({
            provider: "pi",
            name,
            scope: "user",
            configPath: "/home/.pi/agent/mcp.json",
            transport: "http",
          }))
        : {
            servers: ["docs", "auth", "failed"].map((name) => ({
              name,
              scope: "global",
              source: "/home/.pi/agent/mcp.json",
              enabled: true,
              state:
                name === "docs"
                  ? state
                  : name === "auth"
                    ? "needs-auth"
                    : "failed",
              toolCount: 3,
            })),
            errors: [],
          },
    );
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "/mcp",
      undefined,
      vi.fn(),
      undefined,
      "pi",
    );
    await act(async () =>
      container
        .querySelector("textarea")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
    );
    const options = () => [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-mcp-picker] [role="option"]',
      ),
    ];
    expect(options().map((option) => option.disabled)).toEqual([
      false,
      true,
      true,
    ]);
    expect(container.textContent).toContain("Needs authentication");
    expect(container.textContent).toContain("Connection failed");
    expect(mcpInvoke.mock.calls.map(([cmd]) => cmd)).toEqual([
      "mcp_discover",
      "pi_mcp_list",
    ]);
    state = "needs-auth";
    await act(async () => {
      await loadMcpSettings("/repo", true, {
        claudeHealth: false,
        piHealth: true,
      });
    });
    expect(options().every((option) => option.disabled)).toBe(true);
  });

  it("shows four MCP rows at a time and dismisses on outside click or Escape", async () => {
    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? Array.from({ length: 6 }, (_, index) => ({
            provider: "claude",
            name: `server-${index}`,
            scope: "project",
            configPath: "/repo/.mcp.json",
            transport: "stdio",
          }))
        : "",
    );
    await renderComposer(undefined, vi.fn(), false, 0, "/mcp");
    const textarea = container.querySelector("textarea")!;
    const openPicker = async () => {
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    };
    await openPicker();

    const list = container.querySelector<HTMLElement>(
      '[data-mcp-picker] [role="listbox"]',
    )!;
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(6);
    expect(list.classList.contains("max-h-[min(184px,45vh)]")).toBe(true);
    expect(
      list.querySelector('[role="option"]')?.classList.contains("h-11"),
    ).toBe(true);
    expect(container.querySelector("[data-mcp-picker]")?.className).toContain(
      "bg-content/5",
    );
    const searchInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Search MCP servers"]',
    )!;
    const options = list.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(searchInput.getAttribute("aria-controls")).toBe(list.id);
    await act(async () => options[1].focus());
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(searchInput.getAttribute("aria-activedescendant")).toBe(
      options[1].id,
    );
    await act(async () => {
      searchInput.focus();
      for (const key of ["ArrowDown", "Enter", "Escape"]) {
        searchInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            isComposing: true,
          }),
        );
      }
    });
    expect(container.querySelector("[data-mcp-picker]")).not.toBeNull();
    expect(container.textContent).not.toContain("MCP: server-");

    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => {
      outside.focus();
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector("[data-mcp-picker]")).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();

    await typeInto(textarea, "/mcp");
    await openPicker();
    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="Search MCP servers"]',
    )!;
    await act(async () =>
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(container.querySelector("[data-mcp-picker]")).toBeNull();
    expect(document.activeElement).toBe(textarea);

    await typeInto(textarea, "/mcp");
    await openPicker();
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close MCP picker"]',
    )!;
    expect(close.title).toContain("Esc");
    await act(async () => close.click());
    expect(container.querySelector("[data-mcp-picker]")).toBeNull();
  });

  it("removes MCP context when its inline tag is deleted", async () => {
    const onSubmit = vi.fn();
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "/mcp",
      undefined,
      onSubmit,
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const docs = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-mcp-picker] [role="option"]',
      ),
    ].find((button) => button.textContent?.includes("docs"))!;
    await act(async () => docs.click());
    expect(textarea.value).toContain("@mcp/docs");
    await typeInto(textarea, "Find the docs");
    expect(container.querySelector("[data-mcp-tag]")).toBeNull();
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSubmit).toHaveBeenCalledWith(
      "Find the docs",
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("inserts an MCP tag beside existing composer text", async () => {
    await renderComposer(undefined, vi.fn());
    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "sad /mcp");
    const command = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-skill-picker] [role="option"]',
      ),
    ].find((button) => button.textContent?.includes("/mcp"))!;
    expect(command).toBeDefined();
    await act(async () => command.click());
    const docs = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-mcp-picker] [role="option"]',
      ),
    ].find((button) => button.textContent?.includes("docs"))!;
    await act(async () => docs.click());
    expect(textarea.value).toBe("sad @mcp/docs ");
    expect(
      container.querySelector('[data-mcp-tag="@mcp/docs"]'),
    ).not.toBeNull();
  });

  it("restores a Codex MCP tag and its context after switching sessions", async () => {
    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? [
            {
              provider: "codex",
              name: "docs",
              scope: "user",
              configPath: "/codex/config.toml",
              transport: "stdio",
            },
          ]
        : "",
    );
    const onSubmit = vi.fn();
    try {
      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        "/mcp",
        undefined,
        onSubmit,
        "mcp-session-one",
        "codex",
      );
      let textarea = container.querySelector("textarea")!;
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      const docs = container.querySelector<HTMLButtonElement>(
        '[data-mcp-picker] [role="option"]',
      )!;
      expect(mcpInvoke).not.toHaveBeenCalledWith(
        "claude_mcp_list",
        expect.anything(),
      );
      await act(async () => docs.click());
      expect(textarea.value).toContain("@mcp/docs");
      expect(container.querySelector("[data-mcp-tag] svg")).toBeNull();

      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        "Other draft",
        undefined,
        onSubmit,
        "mcp-session-two",
        "codex",
      );
      expect(container.querySelector("[data-mcp-tag]")).toBeNull();

      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        getComposerDraft("mcp-session-one"),
        undefined,
        onSubmit,
        "mcp-session-one",
        "codex",
      );
      textarea = container.querySelector("textarea")!;
      expect(textarea.value).toContain("@mcp/docs");
      expect(
        container.querySelector('[data-mcp-tag="@mcp/docs"]'),
      ).not.toBeNull();
      await typeInto(textarea, `${textarea.value}Use docs`);
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(onSubmit).toHaveBeenCalledWith(
        expect.stringContaining('"docs" (codex)'),
        expect.any(Array),
        expect.any(Object),
      );
    } finally {
      clearComposerDraft("mcp-session-one");
      clearComposerDraft("mcp-session-two");
    }
  });

  it("keeps the draft when onBtwCommand rejects the command", async () => {
    const onBtwCommand = vi.fn(() => false);
    const onSubmit = vi.fn();
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "/btw",
      onBtwCommand,
      onSubmit,
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onBtwCommand).toHaveBeenCalledWith("");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("/btw");
  });

  it("retains typed text and attachments across composer setting changes", async () => {
    const sessionId = "settings-draft";
    const file: Attachment = {
      id: "settings-image", name: "draft.png", kind: "image",
      mimeType: "image/png", size: 3, previewUrl: "blob:settings-image",
    };
    stashComposerAttachments(sessionId, [file], new Set([file.id]));
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    let props = {
      sessionId, focused: true, harness: "claude", model: "claude-sonnet",
      runtimeMode: "supervised", cwd: "/repo", executionCwd: "/repo",
      onFocus: vi.fn(), onCwdChange: vi.fn(), onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(), onSubmit, onDraftChange,
    } as Parameters<typeof Composer>[0];
    try {
      await act(async () => root.render(createElement(Composer, props)));
      const input = container.querySelector("textarea")!;
      await typeInto(input, "保留我的草稿\nwith @file references");
      const changes: Partial<typeof props>[] = [
        { runtimeMode: "full-access" },
        { model: "claude-opus" },
        { modelSettings: { effort: "high" } },
        { cwd: "wsl://Ubuntu/home/dev", executionCwd: "wsl://Ubuntu/home/dev" },
        { workspaceMode: "worktree", worktreeBase: "main" },
        { harness: "fx", model: "fx:default" },
        { harness: "claude", model: "claude-sonnet" },
      ];
      for (const change of changes) {
        props = { ...props, ...change };
        await act(async () => root.render(createElement(Composer, props)));
        expect(container.querySelector("textarea")).toBe(input);
        expect(input.value).toBe("保留我的草稿\nwith @file references");
        expect(container.querySelector('[data-attachment-id="settings-image"]')).not.toBeNull();
        expect(onDraftChange).toHaveBeenLastCalledWith(input.value);
        if (props.harness === "fx") {
          await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
          expect(onSubmit).not.toHaveBeenCalled();
          expect(input.value).toContain("保留我的草稿");
        }
      }
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(onSubmit).toHaveBeenCalledWith("保留我的草稿\nwith @file references", [file], expect.any(Object));
    } finally {
      clearComposerDraft(sessionId);
    }
  });

  it("clears the draft when the reset token advances", async () => {
    const onDraftChange = vi.fn();
    const props = {
      focused: true,
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      executionCwd: "/repo",
      hideProjectPicker: true,
      hideBranchPicker: true,
      initialDraft: "something here...",
      draftResetToken: 1,
      onDraftChange,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    await act(async () => root.render(createElement(Composer, props)));
    expect(container.querySelector("textarea")?.value).toBe(
      "something here...",
    );

    await act(async () =>
      root.render(createElement(Composer, { ...props, draftResetToken: 2 })),
    );
    expect(container.querySelector("textarea")?.value).toBe("");
    expect(onDraftChange).toHaveBeenLastCalledWith("");
  });

  it("keeps drafts and blocks sending until a working copy is selected", async () => {
    const onSubmit = vi.fn();
    const props = {
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      executionCwd: "/deleted-worktree",
      hideProjectPicker: true,
      hideBranchPicker: true,
      initialDraft: "Continue this feature",
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit,
    };
    await act(async () =>
      root.render(createElement(Composer, { ...props, worktreeRemoved: true })),
    );
    const textarea = container.querySelector("textarea")!;
    const send = container.querySelector<HTMLButtonElement>(
      '[aria-label="Send"]',
    )!;
    expect(send.disabled).toBe(true);
    expect(textarea.placeholder).toContain("Select a branch or worktree");
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Continue this feature");
    await act(async () =>
      root.render(
        createElement(Composer, { ...props, worktreeRemoved: false }),
      ),
    );
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenCalledWith("Continue this feature", [], {
      intent: "default",
    });
  });

  it("drops working-copy and branch controls once started, except to recover a removed worktree", async () => {
    const props = {
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      cwd: "/repo",
      executionCwd: "/repo-worktrees/feature",
      branch: "feature",
      startedSession: true,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onWorktreeChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    await act(async () =>
      root.render(createElement(Composer, { ...props, worktreeRemoved: true })),
    );
    expect(container.querySelector('[aria-label="Choose working copy"]')).not.toBeNull();
    await act(async () =>
      root.render(createElement(Composer, { ...props, worktreeRemoved: false })),
    );
    expect(container.querySelector('[aria-label="Choose working copy"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Branch "]')).toBeNull();
    expect(container.querySelector('[aria-label^="Workspace "]')).toBeNull();
    expect(container.querySelector(".composer-project-picker")).toBeNull();
  });

  it("places the caret at the end of an initial draft", async () => {
    const initialDraft = "Comment on src/App.tsx:42\n\n";
    await renderComposer(undefined, vi.fn(), false, 0, initialDraft);

    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe(initialDraft);
    expect(textarea.selectionStart).toBe(initialDraft.length);
    expect(textarea.selectionEnd).toBe(initialDraft.length);
  });

  it("offers /operator in the slash picker and submits it as a local command", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/operator",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(new Event("input", { bubbles: true })),
    );
    const command = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/operator"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/operator ");
    expect(
      container.querySelector('[aria-label="Turn off Operator"]'),
    ).not.toBeNull();
    await act(async () => {
      textarea.value += "list my notes";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );
    expect(onSubmit).toHaveBeenCalledWith("/operator list my notes", [], {
      intent: "default",
    });
  });

  it("keeps /plan in the text beside its pill and submits with the plan intent", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/pla",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(new Event("input", { bubbles: true })),
    );
    const command = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/plan"));
    await act(async () => command!.click());
    expect(textarea.value).toBe("/plan ");
    expect(
      container.querySelector('[aria-label="Turn off Plan mode"]'),
    ).not.toBeNull();
    await act(async () => {
      textarea.value += "sketch the refactor";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );
    expect(onSubmit).toHaveBeenLastCalledWith("sketch the refactor", [], {
      intent: "plan",
    });
  });

  it("keeps a picked /plan in the text beside its pill and submits with the plan intent", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/pla",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(new Event("input", { bubbles: true })),
    );
    const command = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/plan"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/plan ");
    expect(
      container.querySelector('[aria-label="Turn off Plan mode"]'),
    ).not.toBeNull();
    await act(async () => {
      textarea.value += "sketch the refactor";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );
    expect(onSubmit).toHaveBeenLastCalledWith("sketch the refactor", [], {
      intent: "plan",
    });
  });

  it("offers /orchestrator in the slash picker and submits with the orchestrate intent", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/orch",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(new Event("input", { bubbles: true })),
    );
    const command = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/orchestrator"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/orchestrator ");
    expect(
      container.querySelector('[aria-label="Turn off Orchestrator mode"]'),
    ).not.toBeNull();
    await act(async () => {
      textarea.value += "ship the release";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>(
      '[aria-label="Send"]',
    )!;
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenLastCalledWith("ship the release", [], {
      intent: "orchestrate",
    });

    await act(async () => {
      textarea.value = "/orchestrator fix the build";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenLastCalledWith("fix the build", [], {
      intent: "orchestrate",
    });
  });

  it("offers Operator above Orchestrator and sends the /operator command", async () => {
    const onSubmit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "List my notes",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Add files or choose a mode"]',
        )!
        .click(),
    );
    const options = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-composer-plus] button",
      ),
    );
    const operator = options.find((button) =>
      button.textContent?.includes("Operator"),
    )!;
    expect(operator).toBeDefined();
    expect(options.indexOf(operator)).toBeLessThan(
      options.findIndex((button) =>
        button.textContent?.includes("Orchestrator"),
      ),
    );
    await act(async () => operator.click());
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("List my notes");
    expect(
      container.querySelector('[aria-label="Turn off Operator"]'),
    ).not.toBeNull();

    const send = container.querySelector<HTMLButtonElement>(
      '[aria-label="Send"]',
    )!;
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenLastCalledWith("/operator List my notes", [], {
      intent: "default",
    });
    expect(textarea.value).toBe("List my notes");
    expect(
      container.querySelector('[aria-label="Turn off Operator"]'),
    ).not.toBeNull();

    await act(async () => {
      textarea.value = "/operator List my notes";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      send.click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith("/operator List my notes", [], {
      intent: "default",
    });
    expect(textarea.value).toBe("");
    expect(
      container.querySelector('[aria-label="Turn off Operator"]'),
    ).toBeNull();
  });

  it("clears the parent draft before submit so a remounting composer stays empty", async () => {
    let parentDraft = "Ship the empty-state fix";
    const onDraftChange = vi.fn((text: string) => {
      parentDraft = text;
    });
    const baseProps = {
      focused: true,
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      executionCwd: "/repo",
      hideProjectPicker: true,
      hideBranchPicker: true,
      initialDraft: parentDraft,
      onDraftChange,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
    };
    const onSubmit = vi.fn(() => {
      act(() =>
        root.render(
          createElement(Composer, {
            ...baseProps,
            key: "docked",
            initialDraft: parentDraft,
            onSubmit,
          }),
        ),
      );
      return true;
    });
    await act(async () =>
      root.render(
        createElement(Composer, { ...baseProps, key: "empty", onSubmit }),
      ),
    );

    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("Ship the empty-state fix");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );

    expect(onSubmit).toHaveBeenCalledWith("Ship the empty-state fix", [], {
      intent: "default",
    });
    expect(onDraftChange).toHaveBeenCalledWith("");
    expect(parentDraft).toBe("");
    expect(textarea.value).toBe("");
  });

  it("restores the draft when submit is rejected", async () => {
    let parentDraft = "Blocked while orchestration is paused";
    const onDraftChange = vi.fn((text: string) => {
      parentDraft = text;
    });
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          initialDraft: parentDraft,
          onDraftChange,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: () => false,
        }),
      ),
    );

    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );

    expect(textarea.value).toBe("Blocked while orchestration is paused");
    expect(parentDraft).toBe("Blocked while orchestration is paused");
  });

  it("does not restore a failed resend over newer composer text", async () => {
    let recallLastTurn: (() => void) | undefined;
    let rejectResend: ComposerTurnOptions["onResendRejected"];
    const onSubmit = vi.fn(
      (_text: string, _files: Attachment[], options?: ComposerTurnOptions) => {
        rejectResend = options?.onResendRejected;
        return true;
      },
    );

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "pi",
          model: "pi:default",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          editLastTurnSupported: true,
          lastTurnRecall: { text: "Original prompt", attachments: [] },
          onRecallLastTurnReady: (recall) => {
            recallLastTurn = recall;
          },
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    await act(async () => recallLastTurn?.());
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("Original prompt");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );
    await act(async () => {
      textarea.value = "New prompt";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => rejectResend?.({ providerRewound: false }));

    expect(textarea.value).toBe("New prompt");
  });

  it("retries an already rewound prompt as a normal submission", async () => {
    let recallLastTurn: (() => void) | undefined;
    let rejectResend: ComposerTurnOptions["onResendRejected"];
    const onSubmit = vi.fn(
      (_text: string, _files: Attachment[], options?: ComposerTurnOptions) => {
        rejectResend = options?.onResendRejected;
        return true;
      },
    );

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "pi",
          model: "pi:default",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          editLastTurnSupported: true,
          lastTurnRecall: { text: "Edited prompt", attachments: [] },
          onRecallLastTurnReady: (recall) => {
            recallLastTurn = recall;
          },
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    await act(async () => recallLastTurn?.());
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );
    await act(async () => rejectResend?.({ providerRewound: true }));

    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("Edited prompt");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][2]).toEqual({ intent: "default" });
  });

  it("preserves attachment ownership when a resend is restored", async () => {
    const createObjectURL = vi.fn(() => "blob:owned");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let recallLastTurn: (() => void) | undefined;
    let rejectResend: ComposerTurnOptions["onResendRejected"];
    const borrowed: Attachment = {
      id: "borrowed",
      name: "borrowed.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      previewUrl: "blob:borrowed",
    };
    const onSubmit = vi.fn(
      (_text: string, _files: Attachment[], options?: ComposerTurnOptions) => {
        rejectResend = options?.onResendRejected;
        return true;
      },
    );

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "pi",
          model: "pi:default",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          editLastTurnSupported: true,
          lastTurnRecall: {
            text: "Edited prompt",
            attachments: [borrowed],
          },
          onRecallLastTurnReady: (recall) => {
            recallLastTurn = recall;
          },
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    await act(async () => recallLastTurn?.());
    const owned = new File(["new"], "owned.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        files: [owned],
        items: [
          {
            kind: "file",
            type: owned.type,
            getAsFile: () => owned,
          },
        ],
      },
    });
    await act(async () => {
      container.querySelector("textarea")!.dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send"]')!
        .click(),
    );
    await act(async () => rejectResend?.({ providerRewound: false }));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Remove owned.png"]')!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Remove borrowed.png"]')!
        .click(),
    );

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:owned");
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:borrowed");
  });

  it("saves a new message as a draft without submitting it", async () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          canSaveDraft: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
          onSaveDraft,
        }),
      ),
    );

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Add files or choose a mode"]',
        )!
        .click(),
    );
    const draftMode = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Save this message"));
    expect(draftMode).toBeDefined();
    await act(async () => draftMode!.click());

    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      textarea.value = "Explore a quieter empty state";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container.querySelector<HTMLButtonElement>(
      '[aria-label="Save draft"]',
    );
    expect(save?.disabled).toBe(false);
    await act(async () => save!.click());

    expect(onSaveDraft).toHaveBeenCalledWith(
      "Explore a quieter empty state",
      [],
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it("saves a /draft message as a draft and keeps the command in the text", async () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/dra",
          hideProjectPicker: true,
          hideBranchPicker: true,
          canSaveDraft: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
          onSaveDraft,
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(new Event("input", { bubbles: true })),
    );
    const command = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/draft"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/draft ");
    expect(
      container.querySelector('[title="Turn off Draft mode"]'),
    ).not.toBeNull();
    await act(async () => {
      textarea.value += "Explore a quieter empty state";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container.querySelector<HTMLButtonElement>(
      '[aria-label="Save draft"]',
    );
    expect(save).not.toBeNull();
    await act(async () => save!.click());

    expect(onSaveDraft).toHaveBeenCalledWith(
      "Explore a quieter empty state",
      [],
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it("locks a started session to its worktree while keeping its branch editable", async () => {
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          cwd: "/repo",
          executionCwd: "/repo-worktrees/mc-greeting",
          hideProjectPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onWorktreeChange: vi.fn(async () => {}),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
    );

    expect(
      container.querySelector('[aria-label="Choose working copy"]'),
    ).toBeNull();
    // Desktop shows the started working copy in the folder menu, locked.
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.composer-project-picker button[aria-label^="Project"]')!.click(),
    );
    const worktree = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Worktree"]')!;
    expect(worktree.getAttribute("aria-checked")).toBe("true");
    expect(worktree.disabled).toBe(true);
    expect(worktree.closest("label")?.textContent).toContain("mc-greeting");
    const branch = document.querySelector<HTMLButtonElement>('[aria-label="Branch mc/greeting"]');
    expect(branch?.disabled).toBe(false);
  });

  it.each([false, true])("hides Git options for pending and non-Git folders without losing the draft (compact=%s)", async (compact) => {
    const branchesHook = vi.mocked(useProjectBranchesState);
    const original = branchesHook.getMockImplementation()!;
    const onWorkspaceModeChange = vi.fn();
    const props = {
      focused: true, compact, harness: "claude" as const, model: "claude-sonnet",
      runtimeMode: "supervised" as const, cwd: "/repo", executionCwd: "/repo",
      branch: "stale-branch", worktreeBase: "stale-base", draftWorkspace: true,
      initialDraft: "Keep this draft", onFocus: vi.fn(), onCwdChange: vi.fn(),
      onModelChange: vi.fn(), onRuntimeModeChange: vi.fn(), onSubmit: vi.fn(),
      onWorkspaceModeChange, onWorktreeBaseChange: vi.fn(),
    };
    try {
      await act(async () => root.render(createElement(Composer, props)));
      const textarea = container.querySelector("textarea")!;
      if (!compact) {
        await act(async () => container.querySelector<HTMLButtonElement>('.composer-project-picker button[aria-label^="Project"]')!.click());
        expect(document.querySelector('[aria-label="Branch mc/greeting"]')).not.toBeNull();
      }
      for (const state of [
        { branches: null, settled: false },
        { branches: { current: null, detached: false, branches: [] }, settled: true },
        { branches: null, settled: true },
      ]) {
        branchesHook.mockReturnValue(state);
        await act(async () => root.render(createElement(Composer, { ...props, cwd: "/plain", executionCwd: "/plain" })));
        expect(document.querySelector('[data-workspace-menu-worktree]')).toBeNull();
        expect(document.querySelector('[aria-label^="Branch "]')).toBeNull();
        expect(container.querySelector('.composer-git-controls')).toBeNull();
        await act(async () => textarea.dispatchEvent(new KeyboardEvent("keydown", {
          key: "g", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
        })));
        expect(onWorkspaceModeChange).not.toHaveBeenCalled();
        expect(textarea.value).toBe("Keep this draft");
      }
      for (const branches of [
        { current: "project-b", detached: false, branches: [{ name: "project-b", current: true, remote: null }] },
        { current: "unborn-main", detached: false, branches: [] },
        { current: "abcd123", detached: true, branches: [] },
      ]) {
        branchesHook.mockReturnValue({ branches, settled: true });
        await act(async () => root.render(createElement(Composer, { ...props, cwd: "/other", executionCwd: "/other" })));
        expect(document.querySelector(`[aria-label="Branch ${branches.current}"]`)).not.toBeNull();
        expect(document.querySelector('[aria-label="Branch stale-branch"]')).toBeNull();
      }
    } finally {
      branchesHook.mockImplementation(original);
    }
  });

  it("defaults draft worktrees to main while keeping chosen sources and the current checkout", async () => {
    const onWorkspaceModeChange = vi.fn();
    const onWorktreeBaseChange = vi.fn();
    const props = {
      focused: true,
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      cwd: "/repo",
      executionCwd: "/repo",
      branch: "mc/greeting",
      initialDraft: "Keep this draft",
      hideProjectPicker: true,
      draftWorkspace: true,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onBranchChange: vi.fn(async () => {}),
      onWorktreeChange: vi.fn(async () => {}),
      onWorkspaceModeChange,
      onWorktreeBaseChange,
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    await act(async () =>
      root.render(
        createElement(Composer, { ...props, workspaceMode: "current" }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    // Desktop drafts keep branch and worktree choices in the folder menu.
    const project = container.querySelector<HTMLButtonElement>(
      '.composer-project-picker button[aria-label^="Project"]',
    )!;
    await act(async () => project.click());
    expect(
      document.querySelector('[aria-label="Project picker"] [aria-label="Branch mc/greeting"]'),
    ).not.toBeNull();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Worktree"]')!.click(),
    );
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith("worktree", "main");
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("Keep this draft");
    // Hovering opens the branch list beside its row while the folder menu stays open.
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Branch mc/greeting"]')!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(document.querySelector("[data-branch-picker]")).not.toBeNull();
    expect(document.querySelector('[aria-label="Project picker"]')).not.toBeNull();
    await act(async () => project.click());

    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "g",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith("worktree", "main");

    await act(async () =>
      root.render(
        createElement(Composer, { ...props, workspaceMode: "worktree" }),
      ),
    );
    expect(onWorktreeBaseChange).toHaveBeenLastCalledWith("main");
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "G",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(
      "current",
      undefined,
    );

    await act(async () =>
      root.render(
        createElement(Composer, {
          ...props,
          branch: undefined,
          workspaceMode: "current",
        }),
      ),
    );
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "g",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(
      "worktree",
      "main",
    );

    await act(async () =>
      root.render(
        createElement(Composer, {
          ...props,
          branch: undefined,
          workspaceMode: "worktree",
          worktreeBase: "HEAD",
        }),
      ),
    );
    expect(onWorktreeBaseChange).toHaveBeenLastCalledWith("main");
    onWorktreeBaseChange.mockClear();
    await act(async () => root.render(createElement(Composer, {
      ...props, workspaceMode: "worktree", worktreeBase: "release",
    })));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.composer-project-picker button[aria-label^="Project"]')!.click(),
    );
    expect(document.querySelector('[aria-label="Base branch release"]')).not.toBeNull();
    expect(onWorktreeBaseChange).not.toHaveBeenCalled();
  });

  it("names a started worktree by its folder while its branch can change", async () => {
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude" as const,
          model: "claude-sonnet",
          runtimeMode: "supervised" as const,
          cwd: "/repo",
          executionCwd: "/repo-worktrees/mc-3f2a1b7c",
          branch: "mc/fix-login",
          hideProjectPicker: true,
          draftWorkspace: false,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onBranchChange: vi.fn(async () => {}),
          onWorktreeChange: vi.fn(async () => {}),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
    );
    // Desktop folds the working copy into the folder menu instead of the bar.
    expect(container.querySelector('[aria-label^="Workspace"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.composer-project-picker button[aria-label^="Project"]')!.click(),
    );
    const worktree = document.querySelector("[data-workspace-menu-worktree]");
    expect(worktree?.textContent).toContain("mc-3f2a1b7c");
    // The current checkout takes precedence over the session's saved branch.
    expect(document.querySelector('[aria-label="Branch mc/greeting"]')).not.toBeNull();
  });

  it("keeps the hovered branch list open under StrictMode effect replays", async () => {
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(Composer, {
            focused: true,
            harness: "claude" as const,
            model: "claude-sonnet",
            runtimeMode: "supervised" as const,
            cwd: "/repo",
            executionCwd: "/repo",
            branch: "mc/greeting",
            draftWorkspace: true,
            workspaceMode: "current" as const,
            onFocus: vi.fn(),
            onCwdChange: vi.fn(),
            onBranchChange: vi.fn(async () => {}),
            onWorktreeChange: vi.fn(async () => {}),
            onWorkspaceModeChange: vi.fn(),
            onWorktreeBaseChange: vi.fn(),
            onModelChange: vi.fn(),
            onRuntimeModeChange: vi.fn(),
            onSubmit: vi.fn(),
          }),
        ),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.composer-project-picker button[aria-label^="Project"]')!.click(),
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Branch mc/greeting"]')!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.querySelector("[data-branch-picker]")).not.toBeNull();
  });

  it("locks the worktree switch while the first send makes its worktree", async () => {
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude" as const,
          model: "claude-sonnet",
          runtimeMode: "supervised" as const,
          cwd: "/repo",
          executionCwd: "/repo",
          branch: "main",
          hideProjectPicker: true,
          draftWorkspace: true,
          workspaceMode: "worktree" as const,
          worktreeBase: "main",
          worktreeCreation: startWorktreeCreation("main", "run-1"),
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onBranchChange: vi.fn(async () => {}),
          onWorktreeChange: vi.fn(async () => {}),
          onWorkspaceModeChange: vi.fn(),
          onWorktreeBaseChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.composer-project-picker button[aria-label^="Project"]')!.click(),
    );
    const worktree = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Worktree"]')!;
    expect(worktree.getAttribute("aria-checked")).toBe("true");
    expect(worktree.disabled).toBe(true);
  });

  it("returns focus to the composer textarea once a question is answered", async () => {
    const onQuestionReply = vi.fn();
    await renderComposer(question, onQuestionReply);

    await act(async () =>
      (
        container.querySelector("button[aria-pressed]") as HTMLButtonElement
      ).click(),
    );
    await act(async () =>
      (
        container.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click(),
    );
    expect(onQuestionReply).toHaveBeenCalledWith(1, {
      kind: "answered",
      answers: { q1: ["a"] },
    });

    // The real app clears `question` once onQuestionReply resolves it.
    await renderComposer(undefined, onQuestionReply);

    expect(document.activeElement).toBe(container.querySelector("textarea"));
  });

  it("returns focus to the composer textarea once the agent turn finishes", async () => {
    await renderComposer(undefined, vi.fn(), true);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

    const decoy = document.createElement("input");
    document.body.append(decoy);
    decoy.focus();
    expect(document.activeElement).toBe(decoy);

    await renderComposer(undefined, vi.fn(), false);

    expect(document.activeElement).toBe(textarea);
    decoy.remove();
  });

  it("returns focus to the composer textarea when focusToken bumps while already focused", async () => {
    await renderComposer(undefined, vi.fn());
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

    const decoy = document.createElement("input");
    document.body.append(decoy);
    decoy.focus();
    expect(document.activeElement).toBe(decoy);

    // `focused` never changes value here (stays true throughout) — mirrors a
    // real window blur/refocus, where React's composerFocused state doesn't
    // change even though the OS took DOM focus away and back.
    await renderComposer(undefined, vi.fn(), false, 1);

    expect(document.activeElement).toBe(textarea);
    decoy.remove();
  });

  it("preserves the active textarea selection without refocusing on turn and focus-token changes", async () => {
    await renderComposer(undefined, vi.fn(), true);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "selected draft";
    textarea.setSelectionRange(2, 8);
    const focus = vi.spyOn(textarea, "focus");

    await renderComposer(undefined, vi.fn(), false, 1);

    expect(document.activeElement).toBe(textarea);
    expect(focus).not.toHaveBeenCalled();
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 8]);
  });

  it("restores automatic focus without asking the browser to scroll its ancestors", async () => {
    await renderComposer(undefined, vi.fn(), true);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const decoy = document.createElement("input");
    document.body.append(decoy);
    decoy.focus();
    const focus = vi.spyOn(textarea, "focus");

    await renderComposer(undefined, vi.fn(), false);

    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(textarea);
    decoy.remove();
  });

  it("does not steal focus from a control inside a different composer", async () => {
    await renderComposer(undefined, vi.fn(), true);

    // Simulates focus reaching another mounted Composer's control via
    // keyboard Tab navigation, which never fires the onMouseDown-based
    // onFocus that would normally update which pane is "focused".
    const otherComposer = document.createElement("div");
    otherComposer.setAttribute("data-composer", "");
    const otherInput = document.createElement("textarea");
    otherComposer.append(otherInput);
    document.body.append(otherComposer);
    otherInput.focus();
    expect(document.activeElement).toBe(otherInput);

    await renderComposer(undefined, vi.fn(), false);

    expect(document.activeElement).toBe(otherInput);
    otherComposer.remove();
  });

  it("takes focus from a composer in a hidden session", async () => {
    const hiddenSession = document.createElement("div");
    hiddenSession.setAttribute("aria-hidden", "true");
    const hiddenComposer = document.createElement("div");
    hiddenComposer.setAttribute("data-composer", "");
    const hiddenInput = document.createElement("textarea");
    hiddenComposer.append(hiddenInput);
    hiddenSession.append(hiddenComposer);
    document.body.append(hiddenSession);
    hiddenInput.focus();
    expect(document.activeElement).toBe(hiddenInput);

    await renderComposer(undefined, vi.fn());

    expect(document.activeElement).toBe(container.querySelector("textarea"));
    hiddenSession.remove();
  });

  it("does not steal focus from a picker portaled outside the composer", async () => {
    await renderComposer(undefined, vi.fn(), true);

    // Popover.tsx portals picker content directly into document.body, so it
    // never sits under this composer's own [data-composer] subtree.
    const portaledPicker = document.createElement("div");
    portaledPicker.setAttribute("data-model-picker", "");
    const searchInput = document.createElement("input");
    portaledPicker.append(searchInput);
    document.body.append(portaledPicker);
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    await renderComposer(undefined, vi.fn(), false);

    expect(document.activeElement).toBe(searchInput);
    portaledPicker.remove();
  });

  it("opens the MCP picker in Save draft mode and offers Manage", async () => {
    const onSaveDraft = vi.fn();
    const onOpen = vi.fn();
    window.addEventListener("monocode:open-mcp-settings", onOpen);
    try {
      await act(async () =>
        root.render(
          createElement(Composer, {
            focused: true,
            harness: "claude",
            model: "claude-sonnet",
            runtimeMode: "supervised",
            executionCwd: "/repo",
            hideProjectPicker: true,
            hideBranchPicker: true,
            canSaveDraft: true,
            onFocus: vi.fn(),
            onCwdChange: vi.fn(),
            onModelChange: vi.fn(),
            onRuntimeModeChange: vi.fn(),
            onSubmit: vi.fn(),
            onSaveDraft,
          }),
        ),
      );
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Add files or choose a mode"]',
          )!
          .click(),
      );
      const draftMode = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.includes("Save this message"))!;
      await act(async () => draftMode.click());
      const textarea = container.querySelector("textarea")!;
      await act(async () => {
        textarea.value = "/mcp";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(container.querySelector("[data-mcp-picker]")).not.toBeNull();
      expect(onSaveDraft).not.toHaveBeenCalled();
      const manage = [
        ...container.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.includes("Manage MCP Servers"))!;
      await act(async () => manage.click());
      expect(onOpen).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("monocode:open-mcp-settings", onOpen);
    }
  });
});
