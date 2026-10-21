import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "next-themes";
import { themeConfig, DESKTOP_THEME_STORAGE_KEY, MOBILE_THEME_STORAGE_KEY } from "../src/shared/theme/themeConfig";
import { DESKTOP_SKIN_INFO } from "../src/shared/theme/desktopSkin";
import { LEGACY_SKIN_SCHEMES, migrateDesktopTheme } from "../src/shared/theme/desktopAppearance";
import { MOBILE_SKIN_INFO } from "../src/mobile/theme/skin";

// These two functions are serialized, so all runtime inputs are arguments.
function prepare(config, migrate, legacy) {
  let forced;
  try {
    const valid = (value) => value === "light" || value === "dark" || value === "system";
    const shared = localStorage.getItem("omnicode.colorScheme");
    const current = localStorage.getItem(config.storageKey);
    const fallback = valid(shared) ? shared : "dark";
    const preference = config.mobile ? valid(current) ? current : fallback : migrate(localStorage, fallback, legacy);
    const skin = localStorage.getItem(config.skinKey);
    if (skin && Object.hasOwn(config.skins, skin)) {
      forced = config.skins[skin].scheme;
      document.documentElement.dataset[config.mobile ? "mobileSkin" : "skin"] = skin;
    }
    // The mobile key is a local mirror, never the Host wire key.
    if (current !== preference) localStorage.setItem(config.storageKey, preference);
  } catch {
    // next-themes cannot read blocked storage; force its normal dark fallback.
    forced ??= "dark";
  }
  return forced;
}

function finish(config) {
  const root = document.documentElement;
  const key = config.mobile ? "mobileSkin" : "skin";
  root.dataset[key] ??= root.classList.contains("theme-light") ? "daylight" : config.mobile ? "midnight" : "ripple";
  const skin = config.skins[root.dataset[key]];
  if (!config.mobile) root.dataset.desktopVisual = "claude-measured-v1";
  // Supply the launch ground before the application's stylesheet is available.
  const style = document.createElement("style");
  style.dataset.themeBoot = "";
  style.textContent = `html { background: ${skin.app}; }`;
  document.head.append(style);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", skin.app);
}

export function themeBootstrap(mobile = false) {
  const config = {
    mobile,
    storageKey: mobile ? MOBILE_THEME_STORAGE_KEY : DESKTOP_THEME_STORAGE_KEY,
    skinKey: mobile ? "omnicode.mobile.skin" : "omnicode.desktopSkin",
    skins: mobile ? MOBILE_SKIN_INFO : DESKTOP_SKIN_INFO,
  };
  // Use the installed library's own bootstrap, including its class mapping and
  // system resolution. CSR-created script elements alone do not run pre-paint.
  const marker = "__OMNICODE_FORCED_THEME__";
  const markup = renderToStaticMarkup(createElement(ThemeProvider, {
    ...themeConfig, storageKey: config.storageKey, forcedTheme: marker,
  }));
  const script = markup.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!script?.includes(JSON.stringify(marker))) throw new Error("next-themes bootstrap format changed");
  const libraryScript = script.replace(JSON.stringify(marker), "forcedTheme");
  return `(() => { const config = ${JSON.stringify(config)}; const forcedTheme = (${prepare.toString()})(config, ${migrateDesktopTheme.toString()}, ${JSON.stringify(LEGACY_SKIN_SCHEMES)}); ${libraryScript}; (${finish.toString()})(config); })();`;
}

export function themeBootstrapPlugin(mobile = false) {
  return {
    name: "omnicode-theme-bootstrap",
    transformIndexHtml: {
      order: "pre",
      handler: (_html, context) => {
        const entry = context.path;
        if (mobile ? entry !== "/mobile.html" && entry !== "/index.html" : entry !== "/index.html" && entry !== "/quick-composer.html" && entry !== "/") return [];
        return [{ tag: "script", attrs: { "data-theme-bootstrap": "" }, children: themeBootstrap(mobile), injectTo: "head-prepend" }];
      },
    },
  };
}
