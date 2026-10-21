import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { SettingsView } from "../../src/features/settings/ui/SettingsView";
import { useSettingsSection } from "../../src/features/settings/model/useSettingsSection";
import { AppearanceThemeProvider } from "../../src/features/settings/model/AppearanceThemeProvider";
import { DESKTOP_THEME_STORAGE_KEY } from "../../src/shared/theme/themeConfig";
import { DragDropProvider } from "../../src/shared/ui/primitives/Sortable";
import { setUiLanguage } from "../../src/shared/i18n/language";
import "../../src/styles/index.css";

const noop = () => {};
setUiLanguage("en");
Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: noop }, __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
  transformCallback: () => 0, unregisterCallback: noop, convertFileSrc: (path: string) => path,
  invoke: async (command: string) => {
    if (command.startsWith("plugin:event|")) return 0;
    if (command === "system_fonts") return { sans: [], mono: [] };
    if (/list|recents|accounts|sessions|notifications/.test(command)) return [];
    if (/version/.test(command)) return "0.0.0-fixture";
    if (/available|enabled|running/.test(command)) return false;
    return null;
  },
} });

function Fixture() {
  const [section, setSection] = useSettingsSection();
  return <div className="flex h-screen"><SettingsView section={section} onSelectSection={setSection} cwd="" sessions={[]} onClose={noop} onOpenSession={noop} onArchiveSession={noop} onDeleteSession={noop} onOpenWhatsNew={noop} /></div>;
}

createRoot(document.getElementById("root")!).render(
  <NuqsAdapter><AppearanceThemeProvider storageKey={DESKTOP_THEME_STORAGE_KEY}>
    <DragDropProvider><Suspense fallback={null}><Fixture /></Suspense></DragDropProvider>
  </AppearanceThemeProvider></NuqsAdapter>,
);
