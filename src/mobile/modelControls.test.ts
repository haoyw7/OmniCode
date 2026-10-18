// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MobileModelControls,
  configurationForModel,
  configurationForSession,
  type MobileConfiguration,
} from "./MobileModelControls";
import type { HostModelCatalog } from "../features/connections/model/protocol";
import type { AgentModel } from "../features/sessions/model/models";
import { setUiLanguage } from "../shared/i18n/language";
import { HARNESS_TITLE, newSession } from "../features/sessions/model/session";
const catalog: HostModelCatalog = {
  models: {
    codex: [
      {
        id: "codex:full",
        name: "Full model",
        harness: "codex",
        settings: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
      {
        id: "codex:fast",
        name: "Fast model",
        harness: "codex",
        settings: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            kind: "select",
            value: "medium",
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
            ],
          },
        ],
      },
    ],
    claude: [
      {
        id: "claude:test",
        name: "Claude model",
        harness: "claude",
        settings: [
          {
            id: "effort",
            label: "Effort",
            kind: "select",
            value: "medium",
            options: [
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
    ],
    cursor: [{ id: "cursor:test", name: "Cursor model", harness: "cursor" }],
  },
  errors: {},
};
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
beforeEach(() => setUiLanguage("en"));
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
function render(
  lockedAgent = false,
  configuration = configurationForModel(catalog.models.codex![0]),
  allowHandoff = false,
) {
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  const changes: MobileConfiguration[] = [];
  const refresh = (next: MobileConfiguration) => {
    act(() =>
      root.render(
        createElement(MobileModelControls, {
          catalog,
          configuration: next,
          lockedAgent,
          allowHandoff,
          disabled: false,
          onClose: () => {},
          onChange: (value) => {
            changes.push(value);
            refresh(value);
          },
        }),
      ),
    );
  };
  refresh(configuration);
  const row = (name: string) =>
    [...node.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.querySelector("strong")?.textContent === name,
    )!;
  const change = (label: string, value: string) => {
    const back = node.querySelector<HTMLButtonElement>('[aria-label="Back"]');
    if (back) act(() => back.click());
    let name: string;
    if (label === "Agent") {
      act(() => row("Agent").click());
      name = HARNESS_TITLE[value as keyof typeof HARNESS_TITLE];
    } else if (label === "Model") {
      act(() => row("Model").click());
      name = Object.values(catalog.models)
        .flat()
        .find((model) => model?.id === value)!.name;
    } else {
      act(() => row(label).click());
      name = { low: "Low", medium: "Medium", high: "High" }[
        value as "low" | "medium" | "high"
      ];
    }
    const option = [
      ...node.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((button) => button.textContent === name)!;
    expect(option).toBeDefined();
    act(() => option.click());
    const afterBack = node.querySelector<HTMLButtonElement>(
      '[aria-label="Back"]',
    );
    if (afterBack) act(() => afterBack.click());
  };
  return { node, changes, change, row };
}
describe("mobile Agent, model and reasoning controls", () => {
  it("shows the next-send choice while the session still belongs to the original agent", () => {
    const pendingConfiguration = configurationForModel(catalog.models.claude![0]);
    const snapshot = {
      projectId: "project", revision: 1, status: "idle" as const, updatedAt: 0,
      session: { ...newSession("codex", "/repo"), pendingConfiguration },
    };
    const { row, change, changes } = render(true, configurationForSession(snapshot), true);
    expect(row("Agent").textContent).toContain("Claude");
    change("Agent", "codex");
    expect(changes.at(-1)?.harness).toBe("codex");
    expect(snapshot.session.harness).toBe("codex");
  });

  it("shows loading indicators until discovery completes, without treating failure as loading", () => {
    const node = document.createElement("div");
    document.body.append(node);
    root = createRoot(node);
    const onChange = vi.fn();
    const update = (loading: boolean, nextCatalog?: HostModelCatalog) => act(() =>
      root.render(createElement(MobileModelControls, {
        catalog: nextCatalog,
        loading,
        configuration: configurationForModel(catalog.models.codex![0]),
        lockedAgent: false,
        disabled: false,
        onClose: () => {},
        onChange,
      })),
    );
    update(true);
    expect(node.querySelectorAll('.mobile-sheet-row > .mobile-spin[aria-label="Loading…"]')).toHaveLength(3);
    expect(node.textContent).not.toContain("Unavailable");
    for (const row of node.querySelectorAll<HTMLButtonElement>('.mobile-sheet-row[aria-busy="true"]')) {
      expect(row.disabled).toBe(true);
      act(() => row.click());
    }
    expect(onChange).not.toHaveBeenCalled();
    update(false, catalog);
    expect(node.querySelector(".mobile-spin")).toBeNull();
    expect(node.querySelector('[aria-busy="true"]')).toBeNull();
    expect(node.textContent).toContain("Full model");
    expect(node.textContent).toContain("High");
    update(true, catalog);
    expect(node.querySelectorAll(".mobile-sheet-row > .mobile-spin")).toHaveLength(3);
    update(false, { models: {}, errors: { codex: "Model discovery failed" } });
    expect(node.querySelector(".mobile-spin")).toBeNull();
    expect(node.querySelector('[role="alert"]')?.textContent).toBe("Model discovery failed");
  });

  it("opens separate Agent, model and reasoning dialogs without changing settings on back", () => {
    const { node, row, changes } = render();
    expect(
      [...node.querySelectorAll("strong")].map((item) => item.textContent),
    ).toEqual(["Agent", "Model", "Reasoning effort"]);
    expect(node.querySelector('[role="radio"]')).toBeNull();
    for (const label of ["Agent", "Model", "Reasoning effort"]) {
      act(() => row(label).click());
      expect(
        node.querySelector('[role="dialog"]')!.getAttribute("aria-label"),
      ).toBe(label);
      expect(
        node.querySelector('[role="radiogroup"]')!.getAttribute("aria-label"),
      ).toBe(label);
      expect(
        node.querySelector('[role="radio"][aria-checked="true"]'),
      ).not.toBeNull();
      act(() =>
        node.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click(),
      );
      expect(node.querySelector('[role="radio"]')).toBeNull();
    }
    expect(changes).toEqual([]);
  });
  it("filters models by selected Agent and resets provider-specific settings", () => {
    const { node, change, changes } = render();
    change("Agent", "claude");
    expect(changes.at(-1)).toMatchObject({
      harness: "claude",
      model: "claude:test",
      modelSettings: { effort: "medium" },
    });
    expect(changes.at(-1)!.modelSettings).not.toHaveProperty("reasoningEffort");
    expect(
      [...node.querySelectorAll("button")]
        .find(
          (button) => button.querySelector("strong")?.textContent === "Model",
        )!
        .querySelector("small")!.textContent,
    ).toBe("Claude model");
  });
  it("groups models by upstream provider and selects the correct same-name model", () => {
    const models: AgentModel[] = [
      {
        id: "opencode:a/first",
        name: "Shared name",
        harness: "opencode",
        provider: { id: "a", name: "Cloud A" },
      },
      {
        id: "opencode:b/first",
        name: "Shared name",
        harness: "opencode",
        provider: { id: "b", name: "Cloud B" },
      },
      {
        id: "opencode:a/second",
        name: "Second model",
        harness: "opencode",
        provider: { id: "a", name: "Cloud A" },
      },
    ];
    const node = document.createElement("div");
    document.body.append(node);
    root = createRoot(node);
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(MobileModelControls, {
          catalog: { models: { opencode: models }, errors: {} },
          configuration: configurationForModel(models[0], {}, "full-access"),
          disabled: false,
          onClose: () => {},
          onChange,
        }),
      ),
    );
    act(() =>
      [...node.querySelectorAll<HTMLButtonElement>("button")]
        .find(
          (button) => button.querySelector("strong")?.textContent === "Model",
        )!
        .click(),
    );
    expect(
      [...node.querySelectorAll('[role="group"] h3')].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Cloud A", "Cloud B"]);
    expect(
      [...node.querySelectorAll('[role="radio"]')].map((option) =>
        option.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Shared name, Cloud A",
      "Second model, Cloud A",
      "Shared name, Cloud B",
    ]);
    act(() =>
      node
        .querySelector<HTMLButtonElement>(
          '[role="radio"][aria-label="Shared name, Cloud B"]',
        )!
        .click(),
    );
    expect(onChange).toHaveBeenCalledWith(
      configurationForModel(models[1], {}, "full-access"),
    );
  });

  it("sends a chosen thinking level and resets unsupported values after a model switch", () => {
    const { change, changes } = render();
    change("Reasoning effort", "low");
    expect(changes.at(-1)!.modelSettings.reasoningEffort).toBe("low");
    change("Reasoning effort", "high");
    change("Model", "codex:fast");
    expect(changes.at(-1)).toMatchObject({
      model: "codex:fast",
      modelSettings: { reasoningEffort: "medium" },
    });
  });
  it("keeps compatible effort values when changing models", () => {
    const { change, changes } = render();
    change("Reasoning effort", "low");
    change("Model", "codex:fast");
    expect(changes.at(-1)!.modelSettings.reasoningEffort).toBe("low");
  });
  it("does not invent thinking settings for an Agent/model that has none", () => {
    const { node, change, changes } = render();
    change("Agent", "cursor");
    expect(changes.at(-1)!.modelSettings).toEqual({});
    expect(node.querySelector('[aria-label="Reasoning effort"]')).toBeNull();
    expect(
      [...node.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button.querySelector("strong")?.textContent === "Reasoning effort",
      )!.disabled,
    ).toBe(true);
  });
  it("locks only the Agent for existing conversations while allowing model and effort changes", () => {
    const { node, change, changes } = render(true);
    expect(
      [...node.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.querySelector("strong")?.textContent === "Agent",
      )!.disabled,
    ).toBe(true);
    expect(
      [...node.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.querySelector("strong")?.textContent === "Model",
      )!.disabled,
    ).toBe(false);
    change("Reasoning effort", "medium");
    expect(changes.at(-1)!.modelSettings.reasoningEffort).toBe("medium");
  });
  it("lets an existing conversation change Agent when the host supports handoff", () => {
    const { change, changes, row } = render(
      true,
      configurationForModel(catalog.models.codex![0]),
      true,
    );
    expect(row("Agent").disabled).toBe(false);
    change("Agent", "claude");
    expect(changes.at(-1)).toMatchObject({
      harness: "claude",
      model: "claude:test",
    });
  });
});
