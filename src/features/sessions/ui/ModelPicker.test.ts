import { menuPanelWidth } from "../../../shared/ui/primitives/MenuPanel";
// @vitest-environment happy-dom
import { act, createElement, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({
    open,
    children,
    role,
    className,
    tabIndex,
    onKeyDown,
    ...props
  }: {
    open?: boolean;
    children: ReactNode;
    role?: string;
    className?: string;
    tabIndex?: number;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
    minHeight?: number;
    maxHeight?: number;
    style?: CSSProperties;
    anchor?: unknown;
    side?: string;
    "aria-label"?: string;
    "data-model-picker"?: boolean;
  }) =>
    open === false ? null : createElement(
      "div",
      {
        role,
        className,
        tabIndex,
        onKeyDown,
        style: props.style,
        "data-min-height": props.minHeight,
        "data-max-height": props.maxHeight,
        "data-anchor-element":
          props.anchor instanceof HTMLElement ||
          (typeof props.anchor === "object" &&
            props.anchor != null &&
            "current" in props.anchor &&
            props.anchor.current instanceof HTMLElement)
            ? "true"
            : "false",
        "data-side": props.side,
        "data-submenu": (props as Record<string, unknown>)["data-submenu"],
        "aria-label": props["aria-label"],
        "data-model-picker": props["data-model-picker"] ? "" : undefined,
      },
      children,
    ),
}));

import { ModelControlPills, ModelPicker } from "./ModelPicker";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";

it("shares the desktop composer menu width across Chat and Code", () => {
  const root = document.documentElement;
  try {
    root.dataset.skin = "daylight";
    root.dataset.desktopMode = "chat";
    expect(menuPanelWidth("composer", 280)).toBe(242);
    root.dataset.desktopMode = "code";
    expect(menuPanelWidth("composer", 320)).toBe(242);
    expect(menuPanelWidth(undefined, 320)).toBe(320);
    delete root.dataset.skin;
    expect(menuPanelWidth("composer", 280)).toBe(280);
  } finally {
    delete root.dataset.skin;
    delete root.dataset.desktopMode;
  }
});

it("uses session-specific thinking choices in the toolbar menu", () => {
  const model = "pi:provider/live";
  const setting = { id: "thinking", kind: "select" as const, label: "Thinking", value: "off",
    options: [{ value: "off", label: "Off" }, { value: "high", label: "High" }] };
  setHarnessModels("pi", [{ id: model, name: "Live", harness: "pi", settings: [setting] }]);
  act(() => root.render(createElement(ModelControlPills, {
    harness: "pi", model, values: { thinking: "off" }, onSettingsChange: vi.fn(),
    modelSettingOptions: { model, settings: [{ ...setting, options: [setting.options[0]] }] },
  })));
  const trigger = container.querySelector<HTMLButtonElement>("[data-model-control]")!;
  act(() => trigger.click());
  expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(1);
});

it("omits unsupported Pi thinking choices before a live session is started", () => {
  const models = modelsFromRpcData(PI_FLAVOR, { models: [{ id: "flash", provider: "deepseek", reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high" } }] });
  setHarnessModels("pi", models);
  const onSettingsChange = vi.fn();
  act(() => root.render(createElement(ModelControlPills, {
    harness: "pi", model: models[0].id, values: {}, onSettingsChange,
  })));
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Thinking: High"]')!;
  expect(trigger).not.toBeNull();
  act(() => trigger.click());
  const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  expect(choices.map(choice => choice.textContent)).toEqual(["Off", "High"]);
  act(() => choices[1].click());
  expect(onSettingsChange).toHaveBeenCalledWith({ thinking: "high" });
});
import { setUiLanguage } from "../../../shared/i18n/language";
import { modelsFromRpcData } from "../../../integrations/harness/providers/pi/piProtocol";
import {
  PI_FLAVOR,
  OMP_FLAVOR,
} from "../../../integrations/harness/providers/pi/piFlavor";
import {
  beginCatalogLoad,
  resetHarnessModelOverlays,
  saveRecentModelChoice,
  setHarnessModels,
  type ModelSetting,
} from "../model/models";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetHarnessModelOverlays();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  setUiLanguage("en");
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

function press(element: HTMLElement) {
  act(() => element.click());
}

function contextMenu(element: Element) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      }),
    );
  });
}

function keyDown(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

function inputText(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("model picker", () => {
  it.each(["Model", "Reasoning"])("opens %s beside its row and returns focus without changing the selection", (label) => {
    const settings: ModelSetting[] = [{
      id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    }];
    setHarnessModels("codex", [
      { id: "codex:first", name: "First", harness: "codex", settings },
      { id: "codex:second", name: "Second", harness: "codex", settings },
      { id: "codex:third", name: "Third", harness: "codex", settings },
    ]);
    const onChange = vi.fn();
    const onSettingsChange = vi.fn();
    act(() => root.render(createElement(ModelPicker, {
      harness: "codex", model: "codex:third", values: { reasoningEffort: "high" },
      onChange, onSettingsChange,
    })));
    press(container.querySelector<HTMLButtonElement>("[data-model-picker-trigger]")!);
    const menu = container.querySelector<HTMLElement>("[data-model-picker]")!;
    press([...menu.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.startsWith(label))!);
    const flyout = container.querySelector<HTMLElement>('[data-submenu="true"]')!;
    expect(flyout.getAttribute("data-side")).toBe("right");
    expect(flyout.getAttribute("data-anchor-element")).toBe("true");
    expect(menu.getAttribute("aria-label")).toBe("Model and settings");
    expect(menu.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(flyout.querySelector('[aria-label="Back"]')).toBeNull();
    keyDown(flyout, "ArrowLeft");
    expect(container.querySelector('[data-submenu="true"]')).toBeNull();
    const row = [...menu.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.startsWith(label))!;
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it.each(["pointer", "keyboard"])("keeps the combined picker open for consecutive settings and model changes by %s", (input) => {
    const settings: ModelSetting[] = [
      {
        id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high",
        options: [{ value: "low", label: "Low" }, { value: "high", label: "High" }],
      },
      {
        id: "serviceTier", label: "Service Tier", kind: "select", value: "default",
        options: [{ value: "default", label: "Standard" }, { value: "fast", label: "Fast" }],
      },
    ];
    setHarnessModels("codex", [
      { id: "codex:first", name: "First", harness: "codex", settings },
      { id: "codex:second", name: "Second", harness: "codex", settings },
    ]);
    const onClose = vi.fn();
    const onSettingsChange = vi.fn();
    function Picker() {
      const [model, setModel] = useState("codex:first");
      const [values, setValues] = useState<Record<string, string>>({ reasoningEffort: "high", serviceTier: "default" });
      return createElement(ModelPicker, {
        harness: "codex", model, values, onClose,
        onChange: (_, next) => setModel(next),
        onSettingsChange: (next) => {
          onSettingsChange(next);
          setValues(next);
        },
      });
    }
    act(() => root.render(createElement(Picker)));
    const trigger = container.querySelector<HTMLButtonElement>("[data-model-picker-trigger]")!;
    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>('[role="menu"][aria-label="Model and settings"]')!;
    const row = (label: string) => {
      expect(menu.getAttribute("aria-label")).toBe("Model and settings");
      return [...menu.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.startsWith(label))!;
    };
    const choose = (label: string, option: string) => {
      press(row(label));
      const submenu = container.querySelector<HTMLElement>(`[role="menu"][aria-label="${label}"]`)!;
      expect(submenu).not.toBe(menu);
      expect(submenu.getAttribute("data-side")).toBe("right");
      const choices = [...submenu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const selected = choices.find((button) => button.textContent === option)!;
      if (input === "pointer") act(() => selected.click());
      else {
        const from = choices.findIndex((button) => button.getAttribute("aria-checked") === "true");
        const to = choices.indexOf(selected);
        for (let i = 0; i < Math.abs(to - from); i++) keyDown(submenu, to > from ? "ArrowDown" : "ArrowUp");
        keyDown(submenu, "Enter");
      }
      // Choosing an option returns to the settings menu without closing it.
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(menu.isConnected).toBe(true);
      expect(menu.getAttribute("aria-label")).toBe("Model and settings");
      expect(row(label).textContent).toContain(option);
      expect(onClose).not.toHaveBeenCalled();
    };
    choose("Reasoning", "Low");
    choose("Service Tier", "Fast");
    expect(onSettingsChange).toHaveBeenLastCalledWith({ reasoningEffort: "low", serviceTier: "fast" });

    // Both sub-views can return without choosing or changing an option.
    onSettingsChange.mockClear();
    for (const label of ["Model", "Reasoning"]) {
      press(row(label));
      const flyout = container.querySelector<HTMLElement>('[data-submenu="true"]')!;
      keyDown(flyout, "ArrowLeft");
      expect(menu.getAttribute("aria-label")).toBe("Model and settings");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(trigger.textContent).toContain("First");
      expect(row("Reasoning").textContent).toContain("Low");
      expect(onSettingsChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    }

    press(row("Model"));
    // Switching provider tabs stays in the model list.
    const tab = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
    press(tab);
    const modelMenu = container.querySelector<HTMLElement>('[data-submenu="true"][aria-label="Models"]')!;
    expect(modelMenu).not.toBeNull();
    expect(menu.getAttribute("aria-label")).toBe("Model and settings");
    const second = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((button) => button.textContent === "Second")!;
    if (input === "pointer") act(() => second.click());
    else {
      keyDown(modelMenu, "ArrowDown");
      keyDown(modelMenu, "Enter");
    }
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.textContent).toContain("Second");
    expect(row("Model").textContent).toContain("Second");
    choose("Reasoning", "High");
    expect(onSettingsChange).toHaveBeenLastCalledWith({ reasoningEffort: "high", serviceTier: "fast" });
    // Escape first steps back out of a sub-view, then closes the picker.
    press(row("Model"));
    keyDown(window, "Escape");
    expect(menu.getAttribute("aria-label")).toBe("Model and settings");
    expect(onClose).not.toHaveBeenCalled();
    keyDown(window, "Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-model-picker]")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores global menu and Escape events while its app view is hidden", () => {
    const onClose = vi.fn();
    const picker = createElement(ModelPicker, {
      harness: "grok",
      model: "grok:grok-4.6",
      values: {},
      hotkeys: true,
      onChange: vi.fn(),
      onSettingsChange: vi.fn(),
      onClose,
    });
    const renderVisible = (visible: boolean) => act(() => root.render(
      createElement(SurfaceVisibilityContext.Provider, { value: visible }, picker),
    ));
    renderVisible(false);
    act(() => window.dispatchEvent(new Event("open_model_picker")));
    expect(container.querySelector("[data-model-picker]")).toBeNull();

    renderVisible(true);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    expect(container.querySelector("[data-model-picker]")).not.toBeNull();
    renderVisible(false);
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => window.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    renderVisible(true);
    keyDown(window, "Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("translates model controls without changing model names or protocol values", () => {
    setUiLanguage("zh-CN");
    const onChange = vi.fn();
    const onSettingsChange = vi.fn();
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          onChange,
          onSettingsChange,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    expect(trigger.textContent).toBe("Grok 4.6高");
    act(() => trigger.click());
    const effort = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("推理强度"))!;
    press(effort);
    const extraHigh = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "极高")!;
    act(() => extraHigh.click());
    expect(onSettingsChange).toHaveBeenCalledWith({ effort: "xhigh" });
    expect(onChange).not.toHaveBeenCalled();
    act(() => setUiLanguage("en"));
    expect(trigger.textContent).toBe("Grok 4.6High");
  });

  it("shows the model name and effort in the combined picker", () => {
    const onChange = vi.fn();
    const onSettingsChange = vi.fn();
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          onChange,
          onSettingsChange,
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    expect(trigger.textContent).toBe("Grok 4.6High");
    expect(trigger.getAttribute("aria-label")).toBe(
      "Grok Build Grok 4.6, effort High",
    );
    expect(trigger.querySelector(".text-content\\/50")?.textContent).toBe(
      "High",
    );
    expect(trigger.querySelector("svg")).not.toBeNull();

    act(() => trigger.click());
    const modelRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Model"))!;
    expect(modelRow.textContent).toContain("Grok 4.6");
    expect(modelRow.querySelectorAll("svg")).toHaveLength(2);

    press(modelRow);
    const modelFlyout = container.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Models"]',
    )!;
    expect(modelFlyout.style.height).toBe("");
    expect(modelFlyout.style.minHeight).toBe("");
    expect(modelFlyout.dataset.minHeight).toBeUndefined();
    expect(modelFlyout.dataset.maxHeight).toBe("380");
    expect(
      container.querySelector('[role="tablist"][aria-orientation="horizontal"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[role="tab"][aria-label="Favorites"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[role="tab"][aria-label="Antigravity"]'),
    ).not.toBeNull();
    const grokTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-label="Grok Build"]',
    )!;
    expect(grokTab.className).toContain("surface-tab");
    expect(grokTab.className).not.toContain("transition");
    press(grokTab);
    expect(grokTab.getAttribute("aria-selected")).toBe("true");
    expect(
      [...container.querySelectorAll('[role="option"]')].some(
        (option) => option.textContent === "Grok 4.6",
      ),
    ).toBe(true);
    const selectedOption = container.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    )!;
    const selectedRow = selectedOption.parentElement!;
    const favoriteButton = selectedRow.querySelector<HTMLButtonElement>(
      'button[aria-label="Add to favorites"]',
    )!;
    expect(favoriteButton.className).toContain("opacity-0");
    expect(favoriteButton.className).toContain("group-hover:opacity-100");
    expect(selectedRow.lastElementChild?.querySelector("svg")).not.toBeNull();
    const unselectedOption = container.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="false"]',
    )!;
    const unselectedRow = unselectedOption.parentElement!;
    expect(unselectedRow.lastElementChild?.getAttribute("aria-label")).toBe(
      "Add to favorites",
    );
    expect(
      container.querySelector('input[aria-label="Search models"]'),
    ).not.toBeNull();

    keyDown(window, "Escape");
    const effortRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Effort"))!;
    press(effortRow);
    const extraHigh = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Extra High")!;
    act(() => extraHigh.click());

    expect(onSettingsChange).toHaveBeenCalledWith({ effort: "xhigh" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("spins on the trigger until a loading catalog arrives", () => {
    const done = beginCatalogLoad("grok");
    const render = () =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      );
    act(render);
    const spinner = () =>
      container.querySelector('[data-model-picker-trigger] [aria-label="Loading models…"]');
    expect(spinner()).not.toBeNull();

    act(() => {
      setHarnessModels("grok", [{ id: "grok:grok-4.6", name: "Grok 4.6", harness: "grok" }]);
    });
    // A live list is showing, so a refresh still in flight is quiet.
    expect(spinner()).toBeNull();
    act(() => done());
    expect(spinner()).toBeNull();
  });

  it("spins on the trigger while another selectable agent's catalog loads", () => {
    act(() => {
      setHarnessModels("grok", [{ id: "grok:grok-4.6", name: "Grok 4.6", harness: "grok" }]);
    });
    const done = beginCatalogLoad("codex");
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    const spinner = () =>
      container.querySelector('[data-model-picker-trigger] [aria-label="Loading models…"]');
    expect(spinner()).not.toBeNull();

    act(() => done());
    expect(spinner()).toBeNull();
  });

  it("lists Claude Opus 5.5 after Opus 5 in the built-in Claude catalog", () => {
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "claude",
          model: "claude:opus-5-5",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    expect(trigger.textContent).toContain("Claude Opus 5.5");

    act(() => trigger.click());
    const modelRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Model"));
    if (modelRow) press(modelRow);
    const options = [...container.querySelectorAll('[role="option"]')].map(
      (option) => option.textContent,
    );
    expect(options).toContain("Claude Opus 5.5");
    expect(options.indexOf("Claude Opus 5.5")).toBe(
      options.indexOf("Claude Opus 5") + 1,
    );
  });

  it("groups OpenCode models by provider and searches provider names", () => {
    setHarnessModels("opencode", [
      {
        id: "opencode:opencode-go/gpt-5.6-luna",
        harness: "opencode",
        name: "GPT-5.6 Luna",
        nativeId: "opencode-go/gpt-5.6-luna",
        provider: { id: "opencode-go", name: "OpenCode Go" },
      },
      {
        id: "opencode:openai/gpt-5.6-luna",
        harness: "opencode",
        name: "GPT-5.6 Luna",
        nativeId: "openai/gpt-5.6-luna",
        provider: { id: "openai", name: "OpenAI" },
      },
      {
        id: "opencode:openai/gpt-5.6-luna-fast",
        harness: "opencode",
        name: "GPT-5.6 Luna Fast",
        nativeId: "openai/gpt-5.6-luna-fast",
        provider: { id: "openai", name: "OpenAI" },
      },
    ]);

    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "opencode",
          model: "opencode:opencode-go/gpt-5.6-luna",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    expect(trigger.getAttribute("aria-label")).toBe(
      "OpenCode, OpenCode Go, GPT-5.6 Luna",
    );
    act(() => trigger.click());
    const modelRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Model"))!;
    press(modelRow);

    expect(
      [...container.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["OpenCode Go", "OpenAI"]);
    expect(
      container.querySelector('[role="group"][aria-label="OpenCode Go"]')
        ?.textContent,
    ).toContain("GPT-5.6 Luna");
    expect(
      container.querySelector(
        '[role="option"][aria-label="GPT-5.6 Luna, OpenCode Go"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[role="group"][aria-label="OpenAI"]')
        ?.textContent,
    ).toContain("GPT-5.6 Luna Fast");

    inputText(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Search models"]',
      )!,
      "OpenAI",
    );
    expect(
      [...container.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["OpenAI"]);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(container.querySelector(".model-picker-group-label")?.textContent).toBe(
      "OpenAI",
    );
  });

  it.each([PI_FLAVOR, OMP_FLAVOR])(
    "groups $id models and navigates in provider order",
    (flavor) => {
      const models = modelsFromRpcData(flavor, {
        models: [
          { id: "v4", name: "Alpha DeepSeek", provider: "deepseek" },
          { id: "gpt", name: "Beta GPT", provider: "openai" },
          { id: "v4-flash", name: "Gamma DeepSeek", provider: "deepseek" },
        ],
      });
      setHarnessModels(flavor.id, models);
      const onChange = vi.fn();
      act(() =>
        root.render(
          createElement(ModelPicker, {
            harness: flavor.id,
            model: models[0].id,
            values: {},
            hideSettings: true,
            onChange,
            onSettingsChange: vi.fn(),
          }),
        ),
      );
      act(() =>
        container
          .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
          .click(),
      );

      expect(
        [...container.querySelectorAll('[role="group"]')].map((group) =>
          group.getAttribute("aria-label"),
        ),
      ).toEqual(["deepseek", "openai"]);
      expect(
        [...container.querySelectorAll('[role="option"]')].map(
          (option) => option.textContent,
        ),
      ).toEqual(["Alpha DeepSeek", "Gamma DeepSeek", "Beta GPT"]);

      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search models"]',
      )!;
      inputText(search, "openai");
      expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
      expect(container.querySelector('[role="option"]')?.textContent).toBe(
        "Beta GPT",
      );

      inputText(search, "");
      keyDown(search, "ArrowDown");
      keyDown(search, "Enter");
      expect(onChange).toHaveBeenCalledWith(
        flavor.id,
        `${flavor.id}:deepseek/v4-flash`,
      );
    },
  );

  it("names the source of same-name favorites from different providers", () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:auto",
        harness: "cursor",
        name: "Auto",
        nativeId: "auto",
      },
      {
        id: "cursor:muse-spark-1.3",
        harness: "cursor",
        name: "Muse Spark 1.3",
        nativeId: "muse-spark-1.3",
      },
    ]);
    setHarnessModels("opencode", [
      {
        id: "opencode:opencode-go/muse-spark-1.3",
        harness: "opencode",
        name: "Muse Spark 1.3",
        nativeId: "opencode-go/muse-spark-1.3",
        provider: { id: "opencode-go", name: "OpenCode Go" },
      },
    ]);
    localStorage.setItem(
      "monocode.favoriteModels",
      JSON.stringify([
        "cursor:auto",
        "cursor:muse-spark-1.3",
        "opencode:opencode-go/muse-spark-1.3",
      ]),
    );

    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:auto",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    act(() => trigger.click());
    const modelRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Model"))!;
    press(modelRow);
    const favoritesTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-label="Favorites"]',
    )!;
    act(() => favoritesTab.click());

    const options = [...container.querySelectorAll('[role="option"]')].map(
      (option) => option.getAttribute("aria-label"),
    );
    expect(options).toEqual([
      "Auto, Cursor",
      "Muse Spark 1.3, Cursor",
      "Muse Spark 1.3, OpenCode Go",
    ]);
    expect(
      [...container.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["Cursor", "OpenCode Go"]);
  });

  it("can move effort into a dedicated composer control", () => {
    const onSettingsChange = vi.fn();
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ModelPicker, {
            harness: "grok",
            model: "grok:grok-4.6",
            values: { effort: "high" },
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange,
          }),
          createElement(ModelControlPills, {
            harness: "grok",
            model: "grok:grok-4.6",
            values: { effort: "high" },
            onSettingsChange,
          }),
        ),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grok Build Grok 4.6"]',
    )!;
    expect(modelTrigger.textContent).toBe("Grok 4.6");
    act(() => modelTrigger.click());
    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent?.startsWith("Effort"),
      ),
    ).toBe(false);

    const effortTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Effort: High"]',
    )!;
    expect(effortTrigger.textContent).toBe("High");
    expect(effortTrigger.querySelector("svg")).not.toBeNull();
    act(() => effortTrigger.click());
    const effortMenu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Effort"]',
    )!;
    expect(effortMenu).not.toBeNull();
    keyDown(effortMenu, "ArrowUp");
    keyDown(effortMenu, "Enter");
    expect(onSettingsChange).toHaveBeenCalledWith({ effort: "xhigh" });
  });

  it("opens the model list with no intermediate menu when settings live beside the picker", () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:composer-2.5",
        harness: "cursor",
        name: "Composer 2.5",
        nativeId: "composer-2.5",
        settings: [
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ModelPicker, {
            harness: "cursor",
            model: "cursor:composer-2.5",
            values: { fast: "false" },
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange,
          }),
          createElement(ModelControlPills, {
            harness: "cursor",
            model: "cursor:composer-2.5",
            values: { fast: "false" },
            onSettingsChange,
          }),
        ),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    act(() => modelTrigger.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(
      container.querySelector('[role="dialog"][aria-label="Models"]'),
    ).not.toBeNull();

    const fastPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Fast: Off"]',
    )!;
    expect(fastPill.getAttribute("aria-pressed")).toBe("false");
    act(() => fastPill.click());
    expect(onSettingsChange).toHaveBeenCalledWith({ fast: "true" });
  });

  it("focuses the model search when the models submenu opens", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:composer-2.5",
        harness: "cursor",
        name: "Composer 2.5",
        nativeId: "composer-2.5",
        settings: [],
      },
    ]);
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:composer-2.5",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    act(() => modelTrigger.click());
    const modelRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Model"))!;
    press(modelRow);

    // Focus is deferred one frame so the popover is on screen first.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search models"]',
    )!;
    expect(document.activeElement).toBe(search);
  });

  it("renders the OpenCode variant as a beside-picker pill", () => {
    setHarnessModels("opencode", [
      {
        id: "opencode:some-cloud/spark-1",
        harness: "opencode",
        name: "Spark 1",
        nativeId: "some-cloud/spark-1",
        provider: { id: "some-cloud", name: "Some Cloud" },
        settings: [
          {
            id: "variant",
            label: "Variant",
            kind: "select",
            value: "high",
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "xhigh", label: "Extra High" },
            ],
          },
        ],
      },
    ]);
    act(() =>
      root.render(
        createElement(ModelControlPills, {
          harness: "opencode",
          model: "opencode:some-cloud/spark-1",
          values: { variant: "high" },
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const variantPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Variant: High"]',
    )!;
    expect(variantPill.textContent).toBe("High");
    act(() => variantPill.click());
    expect(
      container.querySelector('[role="menu"][aria-label="Variant"]'),
    ).not.toBeNull();
  });

  it.each(["pi", "omp"] as const)(
    "shows an effort icon for %s thinking levels",
    (harness) => {
      const model = `${harness}:gpt-5.4-mini`;
      setHarnessModels(harness, [
        {
          id: model,
          harness,
          name: "GPT-5.4 mini",
          nativeId: "gpt-5.4-mini",
          settings: [
            {
              id: "thinking",
              label: "Thinking",
              kind: "select",
              value: "xhigh",
              options: [
                { value: "high", label: "High" },
                { value: "xhigh", label: "Extra High" },
              ],
            },
          ],
        },
      ]);

      act(() =>
        root.render(
          createElement(ModelControlPills, {
            harness,
            model,
            values: { thinking: "xhigh" },
            onSettingsChange: vi.fn(),
          }),
        ),
      );

      const effortPill = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Thinking: Extra High"]',
      )!;
      expect(effortPill.textContent).toBe("Extra High");
      expect(effortPill.querySelectorAll("svg")).toHaveLength(2);
    },
  );

  it("shows a speed icon on the service-tier pill", () => {
    setHarnessModels("codex", [
      {
        id: "codex:gpt-5.6-luna",
        harness: "codex",
        name: "GPT-5.6 Luna",
        nativeId: "gpt-5.6-luna",
        settings: [
          {
            id: "serviceTier",
            label: "Service Tier",
            kind: "select",
            value: "default",
            options: [
              { value: "default", label: "Standard" },
              { value: "fast", label: "Fast" },
            ],
          },
        ],
      },
    ]);

    act(() =>
      root.render(
        createElement(ModelControlPills, {
          harness: "codex",
          model: "codex:gpt-5.6-luna",
          values: { serviceTier: "default" },
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const serviceTierPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Service Tier: Standard"]',
    )!;
    expect(serviceTierPill.textContent).toBe("Standard");
    expect(serviceTierPill.querySelectorAll("svg")).toHaveLength(2);
  });

  it("shimmers only Codex max and ultra effort options", () => {
    setHarnessModels("codex", [
      {
        id: "codex:gpt-5.6",
        harness: "codex",
        name: "GPT-5.6",
        nativeId: "gpt-5.6",
        settings: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
              { value: "max", label: "Max" },
              { value: "ultra", label: "Ultra" },
            ],
          },
        ],
      },
    ]);

    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "codex",
          model: "codex:gpt-5.6",
          values: { reasoningEffort: "high" },
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
        ?.click(),
    );
    const effortRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Reasoning"))!;
    press(effortRow);

    expect(container.querySelectorAll('[data-effort-tone="max"]')).toHaveLength(
      1,
    );
    expect(
      container.querySelectorAll('[data-effort-tone="ultra"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-effort-tone="max"] .codex-effort-tile'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-effort-tone="max"] .codex-effort-tile'),
    ).toHaveLength(160);
    const filledTiles = container.querySelectorAll(
      '[data-effort-tone="max"] .codex-effort-tile--filled',
    );
    expect(filledTiles.length).toBeGreaterThanOrEqual(96);
    expect(filledTiles.length).toBeLessThanOrEqual(112);
    const high = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent === "High")!;
    expect(high.classList.contains("codex-effort-option")).toBe(false);
  });

  it("changes effort and service tier independently without overwriting the other setting", () => {
    setHarnessModels("codex", [
      {
        id: "codex:gpt-5.6-sol",
        harness: "codex",
        name: "GPT-5.6 Sol",
        nativeId: "gpt-5.6-sol",
        settings: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "high", label: "High" },
              { value: "xhigh", label: "Extra High" },
            ],
          },
          {
            id: "serviceTier",
            label: "Service Tier",
            kind: "select",
            value: "default",
            options: [
              { value: "default", label: "Standard" },
              { value: "fast", label: "Fast" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();
    const onClose = vi.fn();
    function Controls() {
      const [values, setValues] = useState<Record<string, string>>({ reasoningEffort: "high", serviceTier: "default" });
      return createElement(ModelControlPills, {
        harness: "codex", model: "codex:gpt-5.6-sol", values, onClose,
        onSettingsChange: (next) => {
          onSettingsChange(next);
          setValues(next);
        },
      });
    }
    act(() => root.render(createElement(Controls)));

    const tierPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Service Tier: Standard"]',
    )!;
    expect(tierPill).not.toBeNull();
    const effortPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reasoning: High"]',
    )!;
    act(() => effortPill.click());

    const menu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Reasoning"]',
    )!;
    expect(menu.textContent).not.toContain("Standard");
    expect(menu.textContent).not.toContain("Fast");
    const extraHigh = [...menu.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Extra High")!;
    act(() => extraHigh.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({ reasoningEffort: "xhigh", serviceTier: "default" });
    expect(extraHigh.getAttribute("aria-checked")).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    act(() => effortPill.click());
    expect(menu.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    act(() => tierPill.click());
    const tierMenu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Service Tier"]',
    )!;
    expect(tierMenu.textContent).not.toContain("Extra High");
    const fast = [...tierMenu.querySelectorAll("button")].find(
      (button) => button.textContent === "Fast",
    )!;
    act(() => fast.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({ reasoningEffort: "xhigh", serviceTier: "fast" });
    expect(fast.getAttribute("aria-checked")).toBe("true");
    expect(tierPill.textContent).toBe("Fast");
    expect(effortPill.textContent).toBe("Extra High");
  });

  it("keeps fast mode separate from the effort popover", () => {
    setHarnessModels("claude", [
      {
        id: "claude:opus-5",
        harness: "claude",
        name: "Opus 5",
        nativeId: "claude-opus-5",
        settings: [
          {
            id: "effort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
          },
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();

    act(() =>
      root.render(
        createElement(ModelControlPills, {
          harness: "claude",
          model: "claude:opus-5",
          values: { effort: "high", fast: "false" },
          onSettingsChange,
        }),
      ),
    );

    const fastPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Fast: Off"]',
    )!;
    expect(fastPill).not.toBeNull();
    const effortPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Effort: High"]',
    )!;
    act(() => effortPill.click());

    const menu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Effort"]',
    )!;
    expect(menu.textContent).not.toContain("Off");
    expect(menu.textContent).not.toContain("On");
    act(() => effortPill.click());
    act(() => fastPill.click());
    expect(onSettingsChange).toHaveBeenCalledWith({
      effort: "high",
      fast: "true",
    });
  });

  it("opens the model list directly when settings live beside the picker", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:composer-2.5",
        harness: "cursor",
        name: "Composer 2.5",
        nativeId: "composer-2.5",
        settings: [
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ],
          },
        ],
      },
    ]);
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:composer-2.5",
          values: { fast: "false" },
          hideSettings: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    act(() => modelTrigger.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    const flyout = container.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Models"]',
    )!;
    expect(flyout).not.toBeNull();
    expect(flyout.textContent).toContain("Composer 2.5");

    // Search takes focus once the flyout is on screen.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(
      flyout.querySelector('input[aria-label="Search models"]'),
    );

    const selected = flyout.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    )!;
    act(() => selected.click());
    expect(onChange).toHaveBeenCalledWith("cursor", "cursor:composer-2.5");
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(flyout.isConnected).toBe(true);
  });

  it("picks the highlighted model on Enter even when focus sits on another row", () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:first",
        harness: "cursor",
        name: "First",
        nativeId: "first",
      },
      {
        id: "cursor:second",
        harness: "cursor",
        name: "Second",
        nativeId: "second",
      },
    ]);
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:first",
          values: {},
          hideSettings: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    act(() => modelTrigger.click());
    const options = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ];
    expect(options).toHaveLength(2);
    // Focus stays on the first row while arrows move the highlight.
    options[0].focus();
    keyDown(options[0], "ArrowDown");
    keyDown(options[0], "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("cursor", "cursor:second");
  });

  it("leaves favorite toggles to native activation on Enter", () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:first",
        harness: "cursor",
        name: "First",
        nativeId: "first",
      },
      {
        id: "cursor:second",
        harness: "cursor",
        name: "Second",
        nativeId: "second",
      },
    ]);
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:first",
          values: {},
          hideSettings: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    act(() => modelTrigger.click());
    const star = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add to favorites"]',
    )!;
    star.focus();
    keyDown(star, "Enter");
    // No model pick hijacks the favorite toggle (native click owns it).
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns to the selected model's harness when reopened", () => {
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    act(() => trigger.click());
    let modelRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Model"))!;
    press(modelRow);

    const openCodeTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-label="OpenCode"]',
    )!;
    press(openCodeTab);
    expect(openCodeTab.getAttribute("aria-selected")).toBe("true");

    act(() => trigger.click());
    act(() => trigger.click());
    modelRow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Model"))!;
    press(modelRow);

    expect(
      container
        .querySelector('[role="tab"][aria-label="Grok Build"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("quick-switches between recently used models on right-click", () => {
    saveRecentModelChoice("claude", "claude:opus-5");
    saveRecentModelChoice("cursor", "cursor:composer-2.5");
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          hotkeys: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    contextMenu(trigger);

    const recentMenu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Recently used models"]',
    )!;
    expect(recentMenu.dataset.anchorElement).toBe("true");
    expect(recentMenu.dataset.side).toBe("top");
    const recentItems = [
      ...recentMenu.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ];
    expect(recentItems).toHaveLength(3);
    const grokModel = recentItems.find((item) =>
      item.textContent?.includes("Grok 4.6"),
    )!;
    const claudeModel = recentItems.find((item) =>
      item.textContent?.includes("Opus 5"),
    )!;
    const cursorModel = recentItems.find((item) =>
      item.textContent?.includes("Composer 2.5"),
    )!;
    expect(cursorModel.textContent).toContain("Cursor");
    expect(cursorModel.querySelector("svg")).not.toBeNull();

    // The composer can retain focus after opening its toolbar menu. Recent
    // model navigation still needs to own these keys in that state.
    trigger.focus();
    expect(grokModel.className).toContain("bg-selection");
    keyDown(trigger, "ArrowUp");
    expect(claudeModel.className).toContain("bg-selection");
    keyDown(trigger, "ArrowDown");
    expect(grokModel.className).toContain("bg-selection");
    keyDown(trigger, "ArrowDown");
    expect(cursorModel.className).toContain("bg-selection");

    keyDown(trigger, "Enter");
    expect(onChange).toHaveBeenCalledWith("cursor", "cursor:composer-2.5");
    expect(
      container.querySelector(
        '[role="menu"][aria-label="Recently used models"]',
      ),
    ).toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ".",
          code: "Period",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(
      container.querySelector(
        '[role="menu"][aria-label="Recently used models"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[role="menu"][aria-label="Model and settings"]'),
    ).toBeNull();
  });
});
