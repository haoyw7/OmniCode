// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TypographyCards } from "./TypographyCards";
import { defaultAppearanceProfile, loadSystemFonts, type SystemFonts } from "../../../model/typography";
import type { AppearanceSettings } from "./useAppearanceSettings";

vi.mock("../../../model/typography", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../model/typography")>(),
  loadSystemFonts: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
let resolveFonts: (fonts: SystemFonts) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadSystemFonts).mockReturnValue(new Promise((resolve) => {
    resolveFonts = resolve;
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderFonts(font: string) {
  const appearance = {
    profile: { ...defaultAppearanceProfile(), uiFont: font, contentFont: font, codeFont: font },
    fontSizes: { ui: 14, content: 14, code: 12 },
    reducedMotion: "on",
    separateSchemes: false,
    updateProfile: vi.fn(),
  } as unknown as AppearanceSettings;
  await act(async () => root.render(createElement(TypographyCards, { appearance })));
}

function fontTriggers() {
  return ["Interface font", "Content font"].map((label) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label^="${label}:"]`)!,
  );
}

it("shows the saved font in each dropdown while system fonts load and clears custom editors once recognized", async () => {
  await renderFonts("Book Antiqua");
  for (const trigger of fontTriggers()) expect(trigger.textContent).toBe("Book Antiqua");
  expect(container.querySelectorAll('input[aria-label^="Custom "]')).toHaveLength(2);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Code font"]')?.value).toBe("Book Antiqua");

  await act(async () => resolveFonts({ all: ["Book Antiqua"], monospace: ["Book Antiqua"] }));
  for (const trigger of fontTriggers()) expect(trigger.textContent).toBe("Book Antiqua");
  expect(container.querySelectorAll('input[aria-label^="Custom "]')).toHaveLength(0);
});

it("keeps a custom family name visible when it is absent from the system list", async () => {
  await renderFonts("My Custom Font");
  await act(async () => resolveFonts({ all: ["Arial"], monospace: ["Consolas"] }));
  for (const trigger of fontTriggers()) expect(trigger.textContent).toBe("My Custom Font");
  for (const input of container.querySelectorAll<HTMLInputElement>('input[aria-label^="Custom "]')) {
    expect(input.value).toBe("My Custom Font");
  }
});

it("restores default labels and removes stale custom editors when the profile changes", async () => {
  await renderFonts("My Custom Font");
  await renderFonts("");
  expect(fontTriggers().map((trigger) => trigger.textContent)).toEqual([
    "System", "Same as interface font",
  ]);
  expect(container.querySelectorAll('input[aria-label^="Custom "]')).toHaveLength(0);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Code font"]')?.value).toBe("");
});
