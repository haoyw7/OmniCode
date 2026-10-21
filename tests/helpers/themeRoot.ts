import { createElement } from "react";
import { createRoot as createReactRoot, type Root } from "react-dom/client";
import { AppearanceThemeProvider } from "../../src/features/settings/model/AppearanceThemeProvider";
import { DESKTOP_THEME_STORAGE_KEY, MOBILE_THEME_STORAGE_KEY } from "../../src/shared/theme/themeConfig";

export function createRoot(container: Element, mobile = false): Root {
  const root = createReactRoot(container);
  const render = root.render.bind(root);
  root.render = children => render(createElement(AppearanceThemeProvider, {
    storageKey: mobile ? MOBILE_THEME_STORAGE_KEY : DESKTOP_THEME_STORAGE_KEY, children,
  }));
  return root;
}
