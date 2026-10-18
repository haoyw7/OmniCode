// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTE_PROVIDERS,
  type HostModelCatalog,
  type HostSession,
} from "../features/connections/model/protocol";
import { newSession } from "../features/sessions/model/session";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileSessionStatus } from "./MobileSessionStatus";

let root: Root;
let node: HTMLDivElement;
let trigger: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div");
  trigger = document.createElement("button");
  document.body.append(node, trigger);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  trigger.remove();
  setUiLanguage("en");
  vi.unstubAllGlobals();
});
function render(session: HostSession["session"], catalog?: HostModelCatalog) {
  act(() =>
    root.render(
      createElement(MobileSessionStatus, {
        snapshot: {
          session,
          projectId: "project",
          revision: 1,
          status: "idle",
          updatedAt: 1,
        },
        catalog,
        hostName: "Host",
        hostStatus: { state: "connected" },
        anchor: { current: trigger },
        onClose: () => {},
      }),
    ),
  );
  const toggle = node.querySelector<HTMLButtonElement>(".mobile-status-context-toggle")!;
  if (toggle.getAttribute("aria-expanded") === "false") act(() => toggle.click());
  return node.querySelector(".context-breakdown-summary")?.textContent ??
    node.querySelector(".mobile-status-context p")?.textContent;
}

describe("mobile session context status", () => {
  it.each(REMOTE_PROVIDERS)(
    "shows %s's reported context percentage",
    (harness) => {
      expect(
        render({
          ...newSession(harness, "/repo"),
          context: { used: 25_000, window: 100_000 },
        }),
      ).toBe("25% used25k / 100k");
    },
  );
  it("shows tokens when the agent has not supplied a window", () => {
    expect(
      render({ ...newSession("claude", "/repo"), context: { used: 25_000 } }),
    ).toBe("Context used25k");
  });
  it("uses the Host model catalog for a token-only OpenCode reading", () => {
    const session = {
      ...newSession("opencode", "/repo"),
      model: "opencode:provider/model",
      context: { used: 25_000 },
    };
    expect(
      render(session, {
        models: {
          opencode: [
            {
              id: session.model,
              harness: "opencode",
              name: "Model",
              contextWindow: 100_000,
            },
          ],
        },
        errors: {},
      }),
    ).toBe("25% used25k / 100k");
  });
  it("shows unavailable readings and updates them in Chinese", () => {
    expect(render(newSession("cursor", "/repo"))).toBe(
      "Not reported by this agent yet",
    );
    act(() => setUiLanguage("zh-CN"));
    expect(node.textContent).toContain("此 Agent 尚未上报");
    expect(
      render({ ...newSession("pi", "/repo"), context: { used: 12_000 } }),
    ).toBe("上下文已用12k");
  });
});

describe("mobile session agent status", () => {
  it("shows the agent, model and reasoning effort", () => {
    const session = {
      ...newSession("codex", "/repo"),
      model: "codex:gpt",
      modelSettings: { reasoningEffort: "high" },
    };
    render(session, {
      models: {
        codex: [
          {
            id: session.model,
            harness: "codex",
            name: "GPT",
            settings: [
              {
                id: "reasoningEffort",
                label: "Reasoning",
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
      },
      errors: {},
    });
    const agent = node.querySelector(".mobile-status-agent");
    expect(agent?.querySelector("svg, img")).toBeTruthy();
    expect(agent?.querySelector(".mobile-status-agent-name")?.textContent).toBe(
      "Codex · GPT · High",
    );
  });
});
