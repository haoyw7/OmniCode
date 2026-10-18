import { MenuPanel } from "../../../shared/ui/primitives/MenuPanel";
import { motion } from "motion/react";
import { panelTransition, immediateTransition, motionGeometry } from "../../../shared/motion/tokens";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { RotatingIcon } from "../../../shared/ui/RotatingIcon";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { usePreferenceState } from "../../settings/model/usePreferenceState";
import { translate } from "../../../shared/i18n/language";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Gauge,
  Loader,
  Search,
  Star,
  Zap,
} from "../../../shared/ui/icons";
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  coerceModelPickerTab,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  hasLiveCatalog,
  isEffortSettingId,
  loadFavoriteModels,
  loadRecentModelChoices,
  saveFavoriteModels,
  showProviderInModelPicker,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
  type ModelSetting,
  type SessionModelSettings,
  withSessionModelSettings,
} from "../model/models";
import {
  isProviderHidden,
  projectProvidersRevision,
  subscribeProjectProviders,
} from "../model/projectProviders";
import {
  harnessUnavailableHint,
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../../../integrations/harness/core/availability";
import { useModelSource, type ModelSource } from "./modelSource";
import { modelGroups } from "../model/modelGroups";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../model/session";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { HarnessIcon } from "./HarnessIcon";
import type { PopoverAlign } from "../../../shared/lib/popover";
import { MOD } from "../../../platform/tauri/platform";
import { keybindingPressed } from "../../settings/model/settings";
import "./ModelPicker.css";

type Props = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  modelSettingOptions?: SessionModelSettings;
  /** Project whose disabled providers are hidden from the picker. */
  project?: string;
  /** Hide option rows from the menu when they render as pills beside the picker. */
  hideSettings?: boolean;
  /** Cross-axis alignment for menus opened from the toolbar trigger. */
  align?: PopoverAlign;
  /** Limit provider tabs for surfaces that only support one harness. */
  allowedHarnesses?: readonly HarnessId[];
  hotkeys?: boolean;
  appearance?: "composer";
  onChange: (harness: HarnessId, model: string) => void;
  onSettingsChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
};

type MenuEntry = { kind: "setting"; setting: ModelSetting } | { kind: "model" };

/** Nested choices stay beside their root menu row. */
type Submenu = { kind: "setting"; setting: ModelSetting } | { kind: "models" };

type RecentMenu = { models: AgentModel[] };

/** Menu widths retain the established composer density. */
const MENU_WIDTH = 280;
const MODEL_MENU_WIDTH = 320;
const SETTING_MENU_WIDTH = 210;
const SELF = "[data-model-picker]";


/** Long catalogs scroll, while short lists keep their intrinsic height. */
const MODEL_MENU_MAX_HEIGHT = 380;

const SETTING_ORDER = [
  "fast",
  "effort",
  "reasoning",
  "reasoningEffort",
  "serviceTier",
  "thinking",
  "variant",
  "agent",
  "context",
];

/** Toolbar pill order: reasoning level first, then the remaining controls. */
const PILL_ORDER = [
  "effort",
  "reasoning",
  "reasoningEffort",
  "variant",
  "fast",
  "thinking",
  "serviceTier",
  "context",
];

function isEffortSetting(setting: ModelSetting): boolean {
  return isEffortSettingId(setting.id);
}

function effortTileTone(
  harness: HarnessId,
  setting: ModelSetting,
  value: string,
): "ultra" | "max" | undefined {
  if (harness !== "codex" || !isEffortSetting(setting)) return undefined;
  const normalized = value.toLowerCase();
  return normalized === "ultra"
    ? "ultra"
    : normalized === "max"
      ? "max"
      : undefined;
}

const EFFORT_TILE_COLUMNS = 32;
const EFFORT_TILE_ROWS = 5;

function EffortTileShimmer() {
  return (
    <span className="codex-effort-tiles" aria-hidden="true">
      {Array.from(
        { length: EFFORT_TILE_COLUMNS * EFFORT_TILE_ROWS },
        (_, index) => {
          const column = index % EFFORT_TILE_COLUMNS;
          const row = Math.floor(index / EFFORT_TILE_COLUMNS);
          const centerColumn = (EFFORT_TILE_COLUMNS - 1) / 2;
          const centerRow = (EFFORT_TILE_ROWS - 1) / 2;
          const distance = Math.hypot(
            (column - centerColumn) / centerColumn,
            (row - centerRow) / centerRow,
          );
          const filled = (index * 73 + index * index * 19 + 23) % 101 < 65;
          return (
            <span
              key={index}
              className={`codex-effort-tile${filled ? " codex-effort-tile--filled" : ""}`}
              style={{ "--tile-distance": distance } as React.CSSProperties}
            />
          );
        },
      )}
    </span>
  );
}

function effortSetting(model: AgentModel): ModelSetting | undefined {
  return model.settings?.find(
    (setting) => setting.kind === "select" && isEffortSetting(setting),
  );
}

function pickerSettings(model: AgentModel): ModelSetting[] {
  return [...menuVisibleSettings(model)].sort((a, b) => {
    const ai = SETTING_ORDER.indexOf(a.id);
    const bi = SETTING_ORDER.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

/** Settings without the OpenCode agent row, which never shows in the menu. */
function menuVisibleSettings(model: AgentModel): ModelSetting[] {
  return (model.settings ?? []).filter(
    (setting) => !(model.harness === "opencode" && setting.id === "agent"),
  );
}

/** Standalone toolbar pills, reasoning level first. */
function pillSettings(model: AgentModel): ModelSetting[] {
  return [...menuVisibleSettings(model)].sort((a, b) => {
    const ai = PILL_ORDER.indexOf(a.id);
    const bi = PILL_ORDER.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

function settingLabel(setting: ModelSetting): string {
  return translate(
    setting.id === "effort" || setting.id === "reasoning"
      ? "Effort"
      : setting.label,
  );
}

function settingValue(
  setting: ModelSetting,
  values: Record<string, string>,
): string {
  return values[setting.id] ?? setting.value;
}

function settingValueLabel(
  setting: ModelSetting,
  values: Record<string, string>,
): string {
  const value = settingValue(setting, values);
  return translate(
    setting.options.find((option) => option.value === value)?.label ?? value,
  );
}

function recentMenuModels(
  current: AgentModel,
  source: ModelSource,
): AgentModel[] {
  const models = loadRecentModelChoices().flatMap((choice) => {
    const item = source.find(choice.model);
    return item?.harness === choice.harness ? [item] : [];
  });
  if (!models.some((item) => item.id === current.id)) models.push(current);
  return models.slice(0, 6);
}

export function ModelPicker({
  harness,
  model,
  values,
  modelSettingOptions,
  project,
  hideSettings = false,
  align = "start",
  allowedHarnesses,
  hotkeys = false,
  appearance,
  onChange,
  onSettingsChange,
  onClose,
}: Props) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const source = useModelSource();
  const catalogVersion = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const visibilityVersion = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const projectVersion = useSyncExternalStore(
    subscribeProjectProviders,
    projectProvidersRevision,
    projectProvidersRevision,
  );
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModelPickerTab>(harness);
  const [active, setActive] = useState(0);
  const [activeModel, setActiveModel] = useState(0);
  const [activeSetting, setActiveSetting] = useState(0);
  // Sub-view lists start on the selected row for arrow keys, but its check
  // mark is enough; paint the highlight only after the user navigates.
  const [listNavigated, setListNavigated] = useState(false);
  const [recentMenu, setRecentMenu] = useState<RecentMenu | null>(null);
  const [recentActive, setRecentActive] = useState(0);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const entryAnchors = useRef(new Map<string, { current: HTMLButtonElement | null }>());
  const entryAnchor = (key: string) => {
    let anchor = entryAnchors.current.get(key);
    if (!anchor) { anchor = { current: null }; entryAnchors.current.set(key, anchor); }
    return anchor;
  };
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = usePreferenceState(loadFavoriteModels);
  const recentMenuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const submenuMenu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const recentOpenRef = useRef(recentMenu != null);
  const currentRef = useRef<AgentModel | null>(null);
  const lastHotkey = useRef(0);
  const backRef = useRef<() => boolean>(() => false);
  onCloseRef.current = onClose;
  openRef.current = open;
  recentOpenRef.current = recentMenu != null;

  const resolved = source.resolve(harness, model);
  const current = useMemo(
    () => withSessionModelSettings(resolved, modelSettingOptions, model),
    [resolved, modelSettingOptions, model],
  );
  currentRef.current = current;
  const settings = useMemo(() => {
    void catalogVersion;
    // In beside-picker mode every option row renders as a toolbar pill, so the
    // menu lists models only.
    return hideSettings ? [] : pickerSettings(current);
  }, [catalogVersion, current, hideSettings]);
  const entries = useMemo<MenuEntry[]>(
    () => [
      ...settings.map((setting) => ({
        kind: "setting" as const,
        setting,
      })),
      { kind: "model" as const },
    ],
    [settings],
  );

  const triggerEffortSetting = hideSettings
    ? undefined
    : effortSetting(current);
  const triggerEffortLabel = triggerEffortSetting
    ? settingValueLabel(triggerEffortSetting, values)
    : undefined;
  const triggerTitle = [
    HARNESS_TITLE[current.harness],
    current.provider?.name,
    current.name,
    triggerEffortLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const pickerHarnesses = useMemo(() => {
    void availabilityVersion;
    void visibilityVersion;
    void projectVersion;
    return HARNESSES.filter(
      (id) =>
        (!allowedHarnesses || allowedHarnesses.includes(id)) &&
        !isProviderHidden(project, id) &&
        showProviderInModelPicker(id, source.available(id), source.probed()),
    );
  }, [
    source,
    allowedHarnesses,
    availabilityVersion,
    visibilityVersion,
    projectVersion,
    project,
  ]);
  // Show loading on the trigger rather than only inside the opened menu:
  // agents are still being detected, or a selectable agent has no real model
  // list yet. A cached list refreshing in the background is not loading.
  const harnessLoading = (id: HarnessId) =>
    source.loading?.(id) === true && (source.id != null || !hasLiveCatalog(id));
  const triggerLoading =
    !source.probed() ||
    harnessLoading(harness) ||
    pickerHarnesses.some(harnessLoading);
  const providerKey = pickerHarnesses.join(",");
  const visibleTab = coerceModelPickerTab(tab, (id) =>
    pickerHarnesses.includes(id),
  );

  const visibleModels = useMemo(() => {
    void catalogVersion;
    const needle = query.trim().toLowerCase();
    const pool =
      visibleTab === "favorites"
        ? favorites
            .map((id) => source.find(id))
            .filter(
              (item): item is AgentModel =>
                item != null && pickerHarnesses.includes(item.harness),
            )
        : source.modelsFor(visibleTab);
    const filtered = needle
      ? pool.filter((item) =>
          `${item.name} ${HARNESS_TITLE[item.harness]} ${item.provider?.name ?? ""} ${item.provider?.id ?? ""}`
            .toLowerCase()
            .includes(needle),
        )
      : pool;
    // Keyboard navigation and selection must follow the grouped display order.
    return modelGroups(filtered).flatMap((group) =>
      group.models.map(({ item }) => item),
    );
  }, [source, catalogVersion, favorites, providerKey, query, visibleTab]);

  // The view is left as-is while closing so the retained content and the
  // surface size do not jump; opening resets it.
  const dismiss = (restore: boolean) => {
    setOpen(false);
    setRecentMenu(null);
    if (restore) onCloseRef.current?.();
  };

  const togglePicker = () => {
    if (openRef.current) dismiss(true);
    else {
      setRecentMenu(null);
      // Beside-picker mode leaves only the Model row; open its list directly
      // instead of making it one more step.
      setSubmenu(hideSettings ? { kind: "models" } : null);
      setActive(0);
      setQuery("");
      setOpen(true);
    }
  };

  const openRecentMenu = () => {
    const selected = currentRef.current;
    if (!selected) return;
    const models = recentMenuModels(selected, source);
    const selectedIndex = models.findIndex((item) => item.id === selected.id);
    setOpen(false);
    setRecentActive(selectedIndex >= 0 ? selectedIndex : 0);
    setRecentMenu({ models });
  };

  const toggleRecentMenu = () => {
    if (recentOpenRef.current) {
      setRecentMenu(null);
      onCloseRef.current?.();
    } else {
      openRecentMenu();
    }
  };

  const toggleFromHotkey = () => {
    const now = performance.now();
    if (now - lastHotkey.current < 80) return;
    lastHotkey.current = now;
    toggleRecentMenu();
  };

  useEffect(() => {
    if (!open) return;
    source.refresh([current.harness]);
    setTab(
      coerceModelPickerTab(current.harness, (id) =>
        pickerHarnesses.includes(id),
      ),
    );
    setFavorites(loadFavoriteModels());
  }, [open, current.harness, hideSettings]);

  useEffect(() => {
    if (visibleTab === tab) return;
    setTab(visibleTab);
  }, [tab, visibleTab]);

  useEffect(() => {
    if (!open || submenu?.kind !== "models" || visibleTab === "favorites") {
      return;
    }
    source.refresh([visibleTab]);
  }, [open, submenu?.kind, visibleTab]);

  useEffect(() => {
    if (!open) return;
    setActive((index) => Math.min(index, Math.max(0, entries.length - 1)));
  }, [entries.length, open]);

  useEffect(() => {
    if (!open || submenu?.kind !== "models") return;
    const index = visibleModels.findIndex((item) => item.id === current.id);
    setActiveModel(index >= 0 ? index : 0);
    setListNavigated(false);
  }, [open, submenu?.kind, query, visibleModels, current.id]);

  useEffect(() => {
    if (submenu?.kind !== "setting") return;
    const value = settingValue(submenu.setting, values);
    const index = submenu.setting.options.findIndex(
      (option) => option.value === value,
    );
    setActiveSetting(index >= 0 ? index : 0);
    setListNavigated(false);
  }, [submenu, values]);

  useEffect(() => {
    if (!open || submenu?.kind !== "setting") return;
    const frame = requestAnimationFrame(() => submenuMenu.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, submenu]);

  useEffect(() => {
    if (!visible) return;
    const inBlockingUi = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest(".monocode-terminal")) return true;
      return Boolean(
        target.closest(
          "[data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-access-picker], [data-model-control]",
        ),
      );
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      const defaultSwitch =
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "." || event.code === "Period");
      if (
        hotkeys &&
        keybindingPressed("App: Switch Model", event, defaultSwitch)
      ) {
        if (!openRef.current && inBlockingUi(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        toggleFromHotkey();
        return;
      }
      if (!openRef.current || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      // Escape steps back out of a sub-view before it closes the picker.
      if (backRef.current()) return;
      dismiss(true);
    };

    const onMenu = () => {
      if (!hotkeys) return;
      if (inBlockingUi(document.activeElement)) return;
      toggleFromHotkey();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("open_model_picker", onMenu);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("open_model_picker", onMenu);
    };
  }, [visible, hotkeys, source]);

  const setSetting = (setting: ModelSetting, value: string) => {
    onSettingsChange({ ...values, [setting.id]: value });
    // Choosing an option returns to the settings menu.
    goBack();
  };

  const pickModel = (item: AgentModel) => {
    if (!source.available(item.harness)) return;
    onChange(item.harness, item.id);
    // Keep the full picker available for further model/setting changes:
    // picking returns to the settings menu, while switching provider tabs
    // stays in the list. The recent-model shortcut still completes its single
    // quick switch.
    if (recentOpenRef.current) dismiss(true);
    else goBack();
  };

  useEffect(() => {
    if (!visible || !recentMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setRecentActive(
          (index) =>
            (index + direction + recentMenu.models.length) %
            recentMenu.models.length,
        );
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      const item = recentMenu.models[recentActive];
      if (item) pickModel(item);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, recentActive, recentMenu]);

  const toggleFavorite = (id: string) => {
    setFavorites((previous) => {
      const next = previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id];
      saveFavoriteModels(next);
      return next;
    });
  };

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    setQuery("");
    setActiveModel(0);
  };

  const navigateModel: typeof setActiveModel = (next) => {
    setListNavigated(true);
    setActiveModel(next);
  };

  const navigateSetting: typeof setActiveSetting = (next) => {
    setListNavigated(true);
    setActiveSetting(next);
  };

  const enterView = (next: Submenu) => {
    setSubmenu(next);
  };

  const goBack = () => {
    if (hideSettings || submenu == null) return false;
    setSubmenu(null);
    entryAnchor(submenu.kind === "models" ? "model" : `setting:${submenu.setting.id}`).current?.focus({ preventScroll: true });
    return true;
  };
  backRef.current = goBack;

  const showEntrySubmenu = (entry: MenuEntry) => {
    if (entry.kind === "model") {
      enterView({ kind: "models" });
      return;
    }
    if (entry.setting.kind === "select") {
      enterView({ kind: "setting", setting: entry.setting });
    }
  };

  const moveEntry = (direction: 1 | -1) => {
    setSubmenu(null);
    setActive((index) => (index + direction + entries.length) % entries.length);
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const activeSubmenu = event.currentTarget.hasAttribute("data-submenu") ? submenu : null;
    // The model browser handles its own search field and list keys.
    if (event.defaultPrevented || event.target instanceof HTMLInputElement) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (activeSubmenu?.kind === "models") {
        navigateModel((index) =>
          Math.min(visibleModels.length - 1, index + 1),
        );
      } else if (activeSubmenu?.kind === "setting") {
        navigateSetting((index) =>
          Math.min(activeSubmenu.setting.options.length - 1, index + 1),
        );
      } else {
        moveEntry(1);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (activeSubmenu?.kind === "models") {
        navigateModel((index) => Math.max(0, index - 1));
      } else if (activeSubmenu?.kind === "setting") {
        navigateSetting((index) => Math.max(0, index - 1));
      } else {
        moveEntry(-1);
      }
      return;
    }
    if (event.key === "ArrowRight") {
      if (activeSubmenu != null) return;
      event.preventDefault();
      const entry = entries[active];
      if (entry) showEntrySubmenu(entry);
      return;
    }
    if (event.key === "ArrowLeft") {
      if (goBack()) event.preventDefault();
      return;
    }
    if (event.key !== "Enter") return;
    // Favorite toggles keep native activation.
    if (
      event.target instanceof HTMLButtonElement &&
      activeSubmenu != null &&
      !["option", "menuitemradio"].includes(
        event.target.getAttribute("role") ?? "",
      )
    ) {
      return;
    }
    event.preventDefault();
    if (activeSubmenu?.kind === "models") {
      const item = visibleModels[activeModel];
      if (item) pickModel(item);
      return;
    }
    if (activeSubmenu?.kind === "setting") {
      const option = activeSubmenu.setting.options[activeSetting];
      if (option) setSetting(activeSubmenu.setting, option.value);
      return;
    }
    const entry = entries[active];
    if (!entry) return;
    if (entry.kind === "model" || entry.setting.kind === "select") {
      showEntrySubmenu(entry);
      return;
    }
    const value = settingValue(entry.setting, values);
    setSetting(entry.setting, value === "true" ? "false" : "true");
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        data-model-picker-trigger
        data-composer-control={appearance}
        title={uiT("{value0} · Recent models: right-click or {value1}.", {
          value0: String(triggerTitle),
          value1: String(MOD),
        })}
        aria-label={`${HARNESS_TITLE[current.harness]}${
          current.provider ? `, ${current.provider.name},` : ""
        } ${current.name}${
          triggerEffortLabel ? `, effort ${triggerEffortLabel}` : ""
        }`}
        aria-keyshortcuts={`${MOD}.`}
        aria-expanded={open || recentMenu != null}
        aria-haspopup={hideSettings ? "dialog" : "menu"}
        onMouseDown={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openRecentMenu();
        }}
        onClick={() => togglePicker()}
        className={`flex h-6.5 max-w-40 items-center gap-1 rounded-md px-1.5 ${
          open
            ? "bg-selection text-content"
            : "bg-selection text-content hover:bg-selection-hover"
        }`}
      >
        <HarnessIcon harness={current.harness} className="size-4 shrink-0" />
        <span className="model-picker-name model-picker-trigger-text min-w-0 truncate text-[11px]">
          {current.name}
        </span>
        {triggerEffortLabel ? (
          <span className="model-picker-trigger-text shrink-0 text-[11px] text-content/50">
            {triggerEffortLabel}
          </span>
        ) : null}
        {triggerLoading ? (
          <Loader
            className="size-3 shrink-0 text-content/50 motion-safe:animate-spin"
            aria-label={uiT("Loading models…")}
          />
        ) : (
          <ChevronDown
            className={`size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {hideSettings ? (
        <ModelFlyout
          open={open}
          appearance={appearance}
          anchor={button}
          align={align}
          autoFocusSearch
          onDismiss={(reason) => dismiss(reason === "escape")}
          harnesses={pickerHarnesses}
          tab={visibleTab}
          models={visibleModels}
          currentId={current.id}
          active={activeModel}
          query={query}
          favorites={favorites}
          searchRef={search}
          onQuery={setQuery}
          onSelectTab={selectTab}
          showActive={listNavigated}
          onActive={navigateModel}
          onPick={pickModel}
          onToggleFavorite={toggleFavorite}
        />
      ) : null}

      {!hideSettings ? <>
        <MenuPanel
          ref={menu} open={open} appearance={appearance}
          anchor={button} side="top" align={align} width={MENU_WIDTH}
          autoFocus dismissOnEscape={false} ignore={SELF}
          onDismiss={() => dismiss(false)} role="menu"
          aria-label={uiT("Model and settings")} tabIndex={-1}
          onKeyDown={onMenuKey} data-model-picker className="p-1 font-sans"
        >
          {entries.map((entry, index) => {
                const highlighted = index === active;
                if (entry.kind === "model") {
                  return (
                    <button
                      ref={entryAnchor("model")}
                      key="model"
                      type="button"
                      role="menuitem"
                      aria-haspopup="dialog"
                      aria-expanded={submenu?.kind === "models"}
                      data-menu-row="single"
                      data-highlighted={highlighted || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => { setActive(index); showEntrySubmenu(entry); }}
                      onClick={() => {
                        setActive(index);
                        showEntrySubmenu(entry);
                      }}
                      className={`relative isolate flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] leading-5 ${
                        highlighted
                          ? "bg-selection text-content"
                          : "text-content hover:bg-content/3"
                      }`}
                    >
                      <MenuHover />
                      <span data-menu-title className="min-w-0 flex-1">{uiT("Model")}</span>
                      <span className="flex min-w-0 max-w-36 items-center gap-1 text-content/55">
                        <HarnessIcon
                          harness={current.harness}
                          className="size-3.5 shrink-0"
                        />
                        <span className="min-w-0 truncate">{current.name}</span>
                      </span>
                      <ChevronRight data-menu-arrow className="size-4 shrink-0 text-content/45" />
                    </button>
                  );
                }

                const setting = entry.setting;
                const value = settingValue(setting, values);
                const isToggle = setting.kind === "toggle";
                return (
                  <button
                    ref={entryAnchor(`setting:${setting.id}`)}
                    key={setting.id}
                    type="button"
                    role={isToggle ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={isToggle ? value === "true" : undefined}
                    aria-haspopup={isToggle ? undefined : "menu"}
                    aria-expanded={isToggle ? undefined : submenu?.kind === "setting" && submenu.setting.id === setting.id}
                    data-menu-row="single"
                    data-highlighted={highlighted || undefined}
                    title={setting.description}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => { setActive(index); if (isToggle) setSubmenu(null); else showEntrySubmenu(entry); }}
                    onClick={() => {
                      setActive(index);
                      if (isToggle) {
                        setSetting(setting, value === "true" ? "false" : "true");
                      } else {
                        showEntrySubmenu(entry);
                      }
                    }}
                    className={`relative isolate flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] leading-5 ${
                      highlighted
                        ? "bg-selection text-content"
                        : "text-content hover:bg-content/3"
                    }`}
                  >
                    <MenuHover />
                    <span data-menu-title className="min-w-0 flex-1">
                      {settingLabel(setting)}
                    </span>
                    {isToggle ? (
                      <span
                        aria-hidden="true"
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                          value === "true" ? "bg-content/35" : "bg-content/15"
                        }`}
                      >
                        <motion.span initial={false} animate={{ x: value === "true" ? motionGeometry.toggleTravel : 0 }} transition={reducedMotionQuery().matches ? immediateTransition : panelTransition} className="absolute left-0.5 top-0.5 size-4 rounded-full bg-content shadow-sm" />
                      </span>
                    ) : (
                      <>
                        <span className="min-w-0 max-w-28 truncate text-content/55">
                          {settingValueLabel(setting, values)}
                        </span>
                        <ChevronRight data-menu-arrow className="size-4 shrink-0 text-content/45" />
                      </>
                    )}
                  </button>
                );
              })}
        </MenuPanel>
        <MenuPanel
          ref={submenuMenu}
          open={open && submenu != null} appearance={appearance} submenu
          anchor={submenu ? entryAnchor(submenu.kind === "models" ? "model" : `setting:${submenu.setting.id}`) : null}
          width={submenu?.kind === "models" ? MODEL_MENU_WIDTH : SETTING_MENU_WIDTH}
          maxHeight={submenu?.kind === "models" ? MODEL_MENU_MAX_HEIGHT : undefined}
          autoFocus dismissOnEscape={false} ignore={SELF}
          onDismiss={() => goBack()}
          role={submenu?.kind === "models" ? "dialog" : "menu"}
          aria-label={submenu?.kind === "setting" ? settingLabel(submenu.setting) : uiT("Models")}
          tabIndex={-1} onKeyDown={onMenuKey} data-model-picker
          className={submenu?.kind === "models" ? "flex min-h-0 flex-col overflow-hidden font-sans" : "p-1 font-sans"}
        >
            {submenu?.kind === "models" ? (
              <ModelBrowser
                autoFocusSearch
                harnesses={pickerHarnesses}
                tab={visibleTab}
                models={visibleModels}
                currentId={current.id}
                active={activeModel}
                query={query}
                favorites={favorites}
                searchRef={search}
                onQuery={setQuery}
                onSelectTab={selectTab}
                showActive={listNavigated}
                onActive={navigateModel}
                onPick={pickModel}
                onToggleFavorite={toggleFavorite}
              />
            ) : submenu?.kind === "setting" ? (
              <>
                {submenu.setting.options.map((option, index) => {
                  const selected =
                    option.value === settingValue(submenu.setting, values);
                  const highlighted =
                    listNavigated && index === activeSetting;
                  const tileTone = effortTileTone(
                    current.harness,
                    submenu.setting,
                    option.value,
                  );
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      data-menu-row="single"
                      data-highlighted={highlighted || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => navigateSetting(index)}
                      onClick={() => setSetting(submenu.setting, option.value)}
                      className={`relative isolate flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] leading-5 ${
                        highlighted
                          ? "bg-selection text-content"
                          : "text-content hover:bg-content/3"
                      } ${tileTone ? "codex-effort-option" : ""}`}
                      data-effort-tone={tileTone}
                    >
                      <MenuHover />
                      {tileTone ? <EffortTileShimmer /> : null}
                      <span data-menu-title className="min-w-0 flex-1 truncate">
                        {uiT(option.label)}
                      </span>
                      {selected ? (
                        <Check
                          data-menu-check
                          className="size-3.5 shrink-0 text-content/50"
                          strokeWidth={2}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </>
            ) : null}
        </MenuPanel>
      </> : null}

      <MenuPanel
        open={recentMenu != null}
        appearance={appearance}
        inset={appearance === "composer"}
        anchor={button}
        side="top"
        align={align}
        width={MENU_WIDTH}
        autoFocus
        onDismiss={() => setRecentMenu(null)}
        role="menu"
        aria-label={uiT("Recently used models")}
        aria-activedescendant={`${recentMenuId}-${recentActive}`}
        tabIndex={-1}
        onContextMenu={(event) => event.preventDefault()}
        data-model-picker
        className="p-1 font-sans"
      >
        {recentMenu?.models.map((item, index) => {
          const selected = item.id === current.id;
          const highlighted = index === recentActive;
          const disabled = !source.available(item.harness);
          return (
            <button
              key={item.id}
              id={`${recentMenuId}-${index}`}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              data-menu-row="description"
              data-highlighted={highlighted || undefined}
              disabled={disabled}
              title={
                disabled ? harnessUnavailableHint(item.harness) : undefined
              }
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setRecentActive(index)}
              onClick={() => pickModel(item)}
              className={`relative isolate flex min-h-[50px] w-full items-center gap-2 rounded-lg px-2.5 pb-[7px] pt-1.5 text-left disabled:cursor-not-allowed ${
                disabled
                  ? "text-content/30"
                  : highlighted
                    ? "bg-selection text-content"
                    : "text-content hover:bg-content/3"
              }`}
            >
              <MenuHover />
              <HarnessIcon harness={item.harness} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span data-menu-title className="block truncate text-[14px] leading-5">
                  {item.name}
                </span>
                <span data-menu-description className="block truncate text-[13px] leading-[17px] text-content/45">
                  {HARNESS_TITLE[item.harness]}
                  {item.provider ? ` · ${item.provider.name}` : ""}
                </span>
              </span>
              {selected ? (
                <Check
                  data-menu-check
                  className="size-3.5 shrink-0 text-content/55"
                  strokeWidth={2}
                />
              ) : null}
            </button>
          );
        })}
      </MenuPanel>
    </>
  );
}

export function ModelControlPills({
  harness,
  model,
  values,
  modelSettingOptions,
  align = "start",
  onSettingsChange,
  onClose,
  appearance,
}: Pick<
  Props,
  | "harness"
  | "model"
  | "values"
  | "modelSettingOptions"
  | "align"
  | "onSettingsChange"
  | "onClose"
  | "appearance"
>) {
  const catalogVersion = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
  void catalogVersion;
  const resolved = useModelSource().resolve(harness, model);
  const current = useMemo(
    () => withSessionModelSettings(resolved, modelSettingOptions, model),
    [resolved, modelSettingOptions, model],
  );
  const pills = pillSettings(current);
  if (pills.length === 0) return null;
  return (
    <>
      {pills.map((setting) => {
        return setting.kind === "toggle" ? (
          <TogglePill
            appearance={appearance}
            key={setting.id}
            setting={setting}
            values={values}
            onSettingsChange={onSettingsChange}
          />
        ) : (
          <SelectPill
            appearance={appearance}
            key={setting.id}
            setting={setting}
            values={values}
            onSettingsChange={onSettingsChange}
            onClose={onClose}
            harness={harness}
            align={align}
          />
        );
      })}
    </>
  );
}

function TogglePill({
  setting,
  values,
  onSettingsChange,
  appearance,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  onSettingsChange: (settings: Record<string, string>) => void;
  appearance?: "composer";
}) {
  const { t: uiT } = useTranslation();
  const on = settingValue(setting, values) === "true";
  return (
    <button
      type="button"
      title={`${uiT(setting.label)}: ${on ? "On" : "Off"}`}
      aria-label={`${uiT(setting.label)}: ${on ? "On" : "Off"}`}
      aria-pressed={on}
      data-model-control
      data-composer-control={appearance}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() =>
        onSettingsChange({ ...values, [setting.id]: on ? "false" : "true" })
      }
      className="flex h-6.5 max-w-28 items-center gap-1 rounded-md bg-selection px-1.5 text-content hover:bg-selection-hover"
    >
      <span
        className={`min-w-0 truncate text-[11px] ${on ? "" : "text-content/50"}`}
      >
        {uiT(setting.label)}
      </span>
    </button>
  );
}

function SelectPill({
  setting,
  values,
  onSettingsChange,
  onClose,
  harness,
  align,
  additionalSettings,
  appearance,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  onSettingsChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
  harness: HarnessId;
  align: PopoverAlign;
  additionalSettings?: ModelSetting[];
  appearance?: "composer";
}) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const value = settingValue(setting, values);
  const valueLabel = settingValueLabel(setting, values);
  const label = settingLabel(setting);
  const menuSettings = [setting, ...(additionalSettings ?? [])];
  const grouped = menuSettings.length > 1;
  const menuOptions = menuSettings.flatMap((menuSetting) =>
    menuSetting.options.map((option) => ({ setting: menuSetting, option })),
  );
  const menuLabels = menuSettings.map(settingLabel);
  const menuLabel =
    menuLabels.length < 3
      ? menuLabels.join(" and ")
      : `${menuLabels.slice(0, -1).join(", ")}, and ${menuLabels[menuLabels.length - 1]}`;
  const dismiss = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) onClose?.();
  };
  const openPicker = () => {
    const selectedIndex = menuOptions.findIndex(
      (item) => item.setting.id === setting.id && item.option.value === value,
    );
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };
  const pick = (pickedSetting: ModelSetting, optionValue: string) => {
    onSettingsChange({ ...values, [pickedSetting.id]: optionValue });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        title={`${label}: ${valueLabel}`}
        aria-label={`${label}: ${valueLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        data-model-control
        data-composer-control={appearance}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? dismiss(true) : openPicker())}
        className={`flex h-6.5 max-w-28 items-center gap-1 rounded-md px-1.5 ${
          open
            ? "bg-selection text-content"
            : "bg-selection text-content hover:bg-selection-hover"
        }`}
      >
        {isEffortSetting(setting) ? (
          <Gauge className="size-3.5 shrink-0" />
        ) : setting.id === "serviceTier" ? (
          <Zap className="size-3.5 shrink-0" />
        ) : null}
        <span className="min-w-0 truncate text-[11px]">{valueLabel}</span>
        <RotatingIcon icon={ChevronDown} angle={open ? motionGeometry.flipAngle : 0} className="size-3 shrink-0 text-content/50" />
      </button>

      <MenuPanel
        open={open}
        inset={appearance === "composer"}
        anchor={button}
        side="top"
        align={align}
        width={SETTING_MENU_WIDTH}
        autoFocus
        onDismiss={(reason) => dismiss(reason === "escape")}
        role="menu"
        aria-label={menuLabel}
        aria-activedescendant={`${menuId}-${active}`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            setActive(
              (index) =>
                (index + direction + menuOptions.length) % menuOptions.length,
            );
            return;
          }
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const item = menuOptions[active];
          if (item) pick(item.setting, item.option.value);
        }}
        data-model-control
        className="p-1 font-sans"
      >
        {menuSettings.map((menuSetting, groupIndex) => (
          <Fragment key={menuSetting.id}>
            {groupIndex > 0 ? (
              <div role="separator" className="my-1 h-px bg-content/10" />
            ) : null}
            <div
              role={grouped ? "group" : undefined}
              aria-label={grouped ? settingLabel(menuSetting) : undefined}
            >
              {grouped ? (
                <div className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-content/40">
                  {settingLabel(menuSetting)}
                </div>
              ) : null}
              {menuSetting.options.map((option) => {
                const index = menuOptions.findIndex(
                  (item) =>
                    item.setting.id === menuSetting.id &&
                    item.option.value === option.value,
                );
                const selected =
                  option.value === settingValue(menuSetting, values);
                const highlighted = index === active;
                const tileTone = effortTileTone(
                  harness,
                  menuSetting,
                  option.value,
                );
                return (
                  <button
                    key={option.value}
                    id={`${menuId}-${index}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-menu-row="single"
                    data-highlighted={highlighted || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(menuSetting, option.value)}
                    className={`relative isolate flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] leading-5 text-content ${
                      highlighted ? "bg-selection" : "hover:bg-content/3"
                    } ${tileTone ? "codex-effort-option" : ""}`}
                    data-effort-tone={tileTone}
                  >
                    <MenuHover />
                    {tileTone ? <EffortTileShimmer /> : null}
                    <span data-menu-title className="min-w-0 flex-1 truncate">
                      {uiT(option.label)}
                    </span>
                    {selected ? (
                      <Check
                        data-menu-check
                        className="size-3.5 shrink-0 text-content/50"
                        strokeWidth={2}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Fragment>
        ))}
      </MenuPanel>
    </>
  );
}

type ModelBrowserProps = {
  autoFocusSearch?: boolean;
  /** Shows a back button that returns to the settings menu. */
  harnesses: HarnessId[];
  tab: ModelPickerTab;
  models: AgentModel[];
  currentId: string;
  active: number;
  /** False hides the active-row highlight until the user navigates. */
  showActive?: boolean;
  query: string;
  favorites: string[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onSelectTab: (tab: ModelPickerTab) => void;
  onActive: (index: number) => void;
  onPick: (model: AgentModel) => void;
  onToggleFavorite: (id: string) => void;
};

/** Model list shown above the beside-picker pills. */
function ModelFlyout({
  open,
  appearance,
  anchor,
  align = "start",
  onDismiss,
  ...browser
}: ModelBrowserProps & {
  open: boolean;
  appearance?: "composer";
  anchor: HTMLButtonElement | { current: HTMLButtonElement | null } | null;
  align?: PopoverAlign;
  onDismiss?: (reason: "outside" | "escape") => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <MenuPanel
      open={open}
      appearance={appearance}
      inset={appearance === "composer"}
      anchor={anchor}
      side="top"
      align={align}
      width={MODEL_MENU_WIDTH}
      maxHeight={MODEL_MENU_MAX_HEIGHT}
      role="dialog"
      aria-label={uiT("Models")}
      onDismiss={onDismiss}
      data-model-picker
      className="flex min-h-0 flex-col overflow-hidden font-sans"
    >
      <ModelBrowser {...browser} />
    </MenuPanel>
  );
}

function ModelBrowser({
  autoFocusSearch = false,
  harnesses,
  tab,
  models,
  currentId,
  active,
  showActive = true,
  query,
  favorites,
  searchRef,
  onQuery,
  onSelectTab,
  onActive,
  onPick,
  onToggleFavorite,
}: ModelBrowserProps) {
  const { t: uiT } = useTranslation();
  const source = useModelSource();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const selectedTabRef = useRef<HTMLButtonElement>(null);
  const groups = modelGroups(models);
  const tabLoading =
    tab !== "favorites" && source.loading?.(tab) === true;

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    selectedTabRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [tab]);

  // The popover frame starts hidden until its layout effect measures the
  // anchor, and browsers silently drop focus() on a hidden element. React's
  // autoFocus fires during that first commit, so defer one frame to focus
  // once the list is on screen.
  useEffect(() => {
    if (!autoFocusSearch) return;
    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocusSearch, searchRef]);

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onActive(Math.min(models.length - 1, active + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      onActive(Math.max(0, active - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const item = models[active];
      if (item) onPick(item);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.stopPropagation();
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        // Keyboard nav once focus leaves the search field (which stops its
        // own keys). Scoped to the list so provider tabs keep their buttons.
        if (
          !(event.target instanceof Element) ||
          !event.target.closest('[role="listbox"]')
        ) {
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          onActive(
            Math.min(models.length - 1, Math.max(0, active + direction)),
          );
          return;
        }
        if (event.key !== "Enter") return;
        // Favorite toggles keep native activation; model rows activate the
        // highlighted option so Enter never fires on a stale focused row.
        if (
          event.target instanceof HTMLButtonElement &&
          event.target.getAttribute("role") !== "option"
        ) {
          return;
        }
        event.preventDefault();
        const item = models[active];
        if (item) onPick(item);
      }}
    >

      <label className="flex shrink-0 items-center gap-2 border-b border-stroke px-3 py-2 text-content/50">
        <Search className="size-3.5 shrink-0" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          placeholder={uiT("Search models")}
          aria-label={uiT("Search models")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onSearchKey}
        />
        {tabLoading ? (
          <Loader
            className="size-3.5 shrink-0 motion-safe:animate-spin"
            aria-label={uiT("Loading models…")}
          />
        ) : null}
      </label>

      <nav
        role="tablist"
        aria-label={uiT("Providers")}
        aria-orientation="horizontal"
        className="model-picker-providers flex shrink-0 items-center gap-1 overflow-x-auto overscroll-x-contain border-b border-stroke px-1.5 py-1"
        onWheel={(event) => {
          // Mouse wheels scroll vertically; let them pan the provider strip.
          const strip = event.currentTarget;
          if (
            Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
            strip.scrollWidth <= strip.clientWidth
          ) {
            return;
          }
          strip.scrollLeft += event.deltaY;
        }}
      >
        <ProviderTabButton
          ref={tab === "favorites" ? selectedTabRef : undefined}
          title={uiT("Favorites")}
          selected={tab === "favorites"}
          onSelect={() => onSelectTab("favorites")}
        >
          <Star
            className="size-4"
            fill={tab === "favorites" ? "currentColor" : "none"}
          />
        </ProviderTabButton>
        {harnesses.map((harness) => (
          <ProviderTabButton
            key={harness}
            ref={tab === harness ? selectedTabRef : undefined}
            title={HARNESS_TITLE[harness]}
            selected={tab === harness}
            onSelect={() => onSelectTab(harness)}
          >
            <HarnessIcon harness={harness} className="size-4" />
          </ProviderTabButton>
        ))}
      </nav>

      <div
        ref={lockOverscroll}
        role="listbox"
        aria-label={uiT("Models")}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
      >
        {models.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-content/50">
            {tab === "favorites" && !query.trim()
              ? uiT("No favorite models")
              : tab !== "favorites" && !source.available(tab)
                ? harnessUnavailableHint(tab)
                : tabLoading && !query.trim()
                  ? (
                      <span className="flex items-center gap-2">
                        <Loader className="size-3.5 shrink-0 motion-safe:animate-spin" />
                        {uiT("Loading models…")}
                      </span>
                    )
                  : tab === "codex" && !query.trim()
                  ? uiT("Loading Codex models…")
                  : uiT("No matching models")}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} role="group" aria-label={group.name}>
              {group.showLabel ? (
                <div className="model-picker-group-label px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-content/40">
                  {group.name}
                </div>
              ) : null}
              {group.models.map(({ item, index }, position) => {
                const selected = item.id === currentId;
                // The check mark already marks the current model.
                const highlighted =
                  showActive && index === active && !selected;
                const favorited = favorites.includes(item.id);
                const disabled = !source.available(item.harness);
                // Favorites mix harnesses, so every row names its source.
                // Provider first (OpenCode Go vs OpenCode), else harness.
                const provenance =
                  item.provider?.name ?? HARNESS_TITLE[item.harness];
                return (
                  <div
                    key={item.id}
                    data-menu-row="single"
                    data-highlighted={highlighted || undefined}
                    data-disabled={disabled || undefined}
                    className={`group relative isolate flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1.5 ${
                      disabled
                        ? "text-content/30"
                        : highlighted
                          ? "bg-selection text-content"
                          : "text-content hover:bg-content/3"
                    }`}
                    onMouseEnter={() => onActive(index)}
                  >
                    <MenuHover />
                    <button
                      ref={index === active ? activeRef : undefined}
                      type="button"
                      role="option"
                      data-menu-option
                      aria-selected={selected}
                      aria-label={`${item.name}, ${provenance}`}
                      disabled={disabled}
                      title={
                        disabled
                          ? harnessUnavailableHint(item.harness)
                          : undefined
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onPick(item)}
                      className={`flex min-w-0 flex-1 items-center gap-2 p-0 text-left text-[14px] leading-5 disabled:cursor-not-allowed ${
                        // Scrolling a group's first row into view also
                        // reveals its label instead of clipping it.
                        group.showLabel && position === 0
                          ? "scroll-mt-9"
                          : ""
                      }`}
                    >
                      <span data-menu-title className="min-w-0 flex-1 truncate">
                        {item.name}
                      </span>
                    </button>
                    {tab === "favorites" ? (
                      <span className="max-w-24 shrink-0 truncate text-[10px] text-content/40">
                        {provenance}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      data-menu-accessory
                      title={
                        favorited
                          ? uiT("Remove from favorites")
                          : uiT("Add to favorites")
                      }
                      aria-label={
                        favorited
                          ? uiT("Remove from favorites")
                          : uiT("Add to favorites")
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFavorite(item.id);
                      }}
                      className={`grid size-5 shrink-0 place-items-center rounded-md transition-opacity ${
                        favorited
                          ? "text-content/60"
                          : "text-content/35 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <Star
                        className="size-3.5"
                        fill={favorited ? "currentColor" : "none"}
                      />
                    </button>
                    {selected ? (
                      <span
                        aria-hidden="true"
                        data-menu-accessory
                        className="grid size-5 shrink-0 place-items-center"
                      >
                        <Check
                          data-menu-check
                          className="size-3.5 text-content/55"
                          strokeWidth={2}
                        />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ProviderTabButton({
  ref,
  title,
  selected,
  onSelect,
  children,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  title: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  // Tabs switch on click only: the strip sits between the search field and
  // the list, so hover-switching would fire whenever the pointer crosses it.
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      title={title}
      aria-label={title}
      aria-selected={selected}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className="surface-tab grid size-7 shrink-0 place-items-center"
    >
      <span className="shrink-0">{children}</span>
    </button>
  );
}
