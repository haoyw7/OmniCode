// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLanguage } from "../../shared/i18n/language";
import { WhatsNewBody } from "../shell/WhatsNewDialog";
import { UpdateAvailableDialog } from "../shell/UpdateAvailableDialog";
import { ReleaseNotesSurface } from "./ReleaseNotesSurface";

vi.mock("../../features/sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));
vi.mock("../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setUiLanguage("en");
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["dialog", "tab"])(
  "updates bundled %s notes immediately when language changes",
  async (surface) => {
    await act(async () =>
      root.render(
        surface === "dialog"
          ? createElement(WhatsNewBody, { version: "0.11.0" })
          : createElement(ReleaseNotesSurface, {
              source: { version: "0.11.0" },
            }),
      ),
    );
    expect(container.textContent).toContain("### Fixed");
    expect(container.textContent).not.toContain("### 修复");
    await act(async () => setUiLanguage("zh-CN"));
    expect(container.textContent).toContain("### 修复");
    expect(container.textContent).not.toContain("### Fixed");
    await act(async () => setUiLanguage("en"));
    expect(container.textContent).toContain("### Fixed");
    expect(container.textContent).not.toContain("### 修复");
  },
);

it("selects remote update notes without requiring a bundled version", async () => {
  await act(async () =>
    root.render(
      createElement(UpdateAvailableDialog, {
        snapshot: {
          phase: "available",
          currentVersion: "0.11.0",
          availableVersion: "9.9.9",
          releaseNotes:
            "<!-- release-notes:en -->\nNew release\n<!-- /release-notes -->\n<!-- release-notes:zh-CN -->\n新版日志\n<!-- /release-notes -->",
        },
        onInstall: vi.fn(),
        onSkip: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("New release");
  expect(container.textContent).not.toContain("新版日志");
  await act(async () => setUiLanguage("zh-CN"));
  expect(container.textContent).toContain("新版日志");
  expect(container.textContent).not.toContain("New release");
});
