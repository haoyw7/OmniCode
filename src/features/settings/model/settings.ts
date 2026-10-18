import { preferenceStorage } from "./sharedPreferences";
import {
  ALT,
  IS_LINUX,
  IS_MAC,
  IS_WIN,
  MOD,
  SHIFT,
} from "../../../platform/tauri/platform";
import {
  canonicalShortcut,
  isGlobalShortcut,
  QUICK_COMPOSER_DEFAULT_SHORTCUT,
  quickComposerShortcutLabel,
  shortcutFromKeyEvent,
  shortcutTokens,
} from "../../quick-composer/model/quickComposerShortcut";
import { readFlag, writeFlag } from "./storageFlags";
import { translate } from "../../../shared/i18n/language";

const SECTION_KEY = "omnicode.settingsSection";

export type SettingsSectionId =
  | "general"
  | "connections"
  | "appearance"
  | "keybindings"
  | "chat"
  | "providers"
  | "import"
  | "mcp"
  | "skills"
  | "inbox"
  | "worktrees"
  | "archive";

/** Rail buckets. Sections list in order under their group label. */
export type SettingsGroupId = "app" | "agents" | "workspace";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "app", label: "App" },
  { id: "agents", label: "Agents" },
  { id: "workspace", label: "Workspace" },
];

export type SettingsSection = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  description: string;
  /** Extra words search matches the section on, beyond its label. */
  keywords?: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    group: "app",
    label: "General",
    description:
      "The build you are running, how OmniCode reaches you, and the panels it shows.",
    keywords: "version update sounds notifications notes rail",
  },
  {
    id: "connections",
    group: "app",
    label: "Connections",
    description:
      "Let other devices control this computer, and run agents on your machines through SSH.",
    keywords:
      "ssh remote host machine server environment always on phone mobile device pair token revoke",
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description:
      "Theme, typography, translucency, workspace layout, and conversation backgrounds.",
    keywords:
      "theme dark light color accent glass blur zoom scale wallpaper rail sidebar",
  },
  {
    id: "keybindings",
    group: "app",
    label: "Keybindings",
    description:
      "Every shortcut the workspace handles, from the app menu and the key handler.",
    keywords: "shortcut hotkey keyboard binding",
  },
  {
    id: "chat",
    group: "agents",
    label: "Chat",
    description:
      "How transcripts read, what the composer does with a follow-up, how files save, and how diffs open.",
    keywords:
      "transcript composer prompt message diff review layout format save editor",
  },
  {
    id: "providers",
    group: "agents",
    label: "Providers",
    description:
      "Provider accounts, agent CLIs OmniCode can drive, and the model new sessions start with.",
    keywords:
      "account sign in login model harness claude codex gemini cli default hooks",
  },
  {
    id: "import",
    group: "agents",
    label: "Import",
    description:
      "Bring conversations from other AI coding apps into OmniCode, follow them live, and continue them here.",
    keywords:
      "import native sessions claude code codex pi omp opencode history sync resume 导入 同步 会话 历史",
  },
  {
    id: "mcp",
    group: "agents",
    label: "MCP",
    description:
      "Find MCP servers across providers and manage their connections.",
    keywords:
      "tools servers connections oauth authenticate login claude codex cursor opencode",
  },
  {
    id: "skills",
    group: "agents",
    label: "Skills",
    description:
      "Discover and manage file skills from project, personal, and harness folders.",
    keywords: "skill instructions prompt",
  },
  {
    id: "inbox",
    group: "workspace",
    label: "Inbox",
    description:
      "Manage Inbox services and notification preferences for each project.",
    keywords:
      "github gitlab linear jira atlassian azure devops connect token integration",
  },
  {
    id: "archive",
    group: "workspace",
    label: "Archive",
    description: "Projects and conversations you have archived.",
    keywords: "archived restore delete hidden",
  },
  {
    id: "worktrees",
    group: "workspace",
    label: "Worktrees",
    description: "Manage additional worktrees for each project.",
    keywords: "git branch worktree working copy project create delete",
  },
];

export function settingsSectionsByGroup(): {
  id: SettingsGroupId;
  label: string;
  sections: SettingsSection[];
}[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    label: translate(group.label),
    sections: SETTINGS_SECTIONS.filter(
      (section) => section.group === group.id,
    ).map((section) => ({
      ...section,
      label: translate(section.label),
      description: translate(section.description),
    })),
  })).filter((group) => group.sections.length > 0);
}

/**
 * One searchable control. `id` is the row's `data-setting-id` in SettingsView,
 * which is also what Settings scrolls to when it opens on an anchor.
 */
export type SettingsEntry = {
  id: string;
  section: SettingsSectionId;
  label: string;
  keywords?: string;
};

export const SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "title-model",
    section: "chat",
    label: "Session titles",
    keywords: "title summary model API endpoint key 标题 摘要 模型 接口 密钥",
  },
  {
    id: "ui-language",
    section: "general",
    label: "Interface language",
    keywords: "language locale english chinese 中文 简体中文 语言 界面",
  },
  {
    id: "controlling-devices",
    section: "connections",
    label: "Devices that can control this computer",
    keywords: "phone mobile device pair token revoke access control this computer",
  },
  {
    id: "remote-machines",
    section: "connections",
    label: "Your machines",
    keywords: "ssh remote connect host server environment",
  },
  {
    id: "mcp-servers",
    section: "mcp",
    label: "MCP servers",
    keywords: "claude tools connections oauth authenticate login add remove",
  },
  {
    id: "project-worktrees",
    section: "worktrees",
    label: "Project worktrees",
    keywords: "git branch working copy create delete manage",
  },
  {
    id: "update",
    section: "general",
    label: "Version",
    keywords: "update upgrade release what's new build changelog",
  },
  {
    id: "sounds",
    section: "general",
    label: "Sounds",
    keywords: "audio cue chime mute volume",
  },
  {
    id: "notifications",
    section: "general",
    label: "Notifications",
    keywords: "notify alert toast permission reminder background",
  },
  {
    id: "notes",
    section: "general",
    label: "Notes",
    keywords: "notebook markdown rail scratchpad",
  },
  ...(IS_MAC
    ? [
        {
          id: "quick-composer",
          section: "general" as const,
          label: "Quick composer",
          keywords: "spotlight global shortcut hotkey floating prompt anywhere",
        },
      ]
    : []),
  {
    id: "working-agents",
    section: "general",
    label: "Working agents",
    keywords: "live running sessions rail card",
  },
  {
    id: "file-tabs",
    section: "general",
    label: "File tabs",
    keywords: "editor open top workspace normal session pane beside chat",
  },
  {
    id: "tab-animations",
    section: "general",
    label: "Tab animations",
    keywords: "motion open close resize transition",
  },
  ...(IS_WIN || IS_LINUX
    ? [
        {
          id: "close-to-tray",
          section: "general" as const,
          label: "Close to tray",
          keywords: "minimize background quit exit window taskbar windows",
        },
      ]
    : []),
  {
    id: "theme",
    section: "appearance",
    label: "Theme",
    keywords: "dark light system appearance mode",
  },
  {
    id: "desktop-skin",
    section: "appearance",
    label: "Skin",
    keywords: "palette theme automatic midnight foundry graphite dusk black daylight atelier lagoon linen meadow 自动 午夜 铸铁 石墨 暮色 纯黑 日光 画室 潟湖 亚麻 草地",
  },
  {
    id: "compact-sidebar",
    section: "appearance",
    label: "Compact sidebar",
    keywords: "dense rows density list conversations projects smaller",
  },
  {
    id: "ui-font-size",
    section: "appearance",
    label: "Interface font size",
    keywords: "text size bigger smaller px 界面 字号 字体大小",
  },
  {
    id: "content-font-size",
    section: "appearance",
    label: "Content font size",
    keywords: "chat message markdown text size px 内容 字号 正文",
  },
  {
    id: "code-font-size",
    section: "appearance",
    label: "Code font size",
    keywords: "monospace diff code block text size px 代码 字号 差异",
  },
  {
    id: "reduced-motion",
    section: "appearance",
    label: "Reduce motion",
    keywords: "animation accessibility transition 减少 动态 动画 效果",
  },
  {
    id: "separate-schemes",
    section: "appearance",
    label: "Separate light and dark settings",
    keywords: "per mode theme colors fonts 浅色 深色 分别 设置",
  },
  {
    id: "ui-font-weight",
    section: "appearance",
    label: "Interface font",
    keywords: "typeface family system weight bold medium regular 界面 字体 系统 样式 粗细 字重",
  },
  {
    id: "content-font",
    section: "appearance",
    label: "Content font",
    keywords: "typeface family chat markdown 内容 字体",
  },
  {
    id: "code-font",
    section: "appearance",
    label: "Code font",
    keywords: "typeface family monospace mono 代码 字体 等宽",
  },
  {
    id: "contrast",
    section: "appearance",
    label: "Contrast",
    keywords: "legibility text borders readability 对比度",
  },
  {
    id: "accent-color",
    section: "appearance",
    label: "Accent color",
    keywords: "highlight bubble send button tint",
  },
  {
    id: "window-opacity",
    section: "appearance",
    label: "Desktop transparency",
    keywords: "glass translucent opacity whole overall window",
  },
  {
    id: "sidebar-opacity",
    section: "appearance",
    label: "Sidebar transparency",
    keywords: "glass translucent opacity vibrancy",
  },
  {
    id: "popover-opacity",
    section: "appearance",
    label: "Popover transparency",
    keywords:
      "dropdown menu picker dialog modal popup glass translucent opacity vibrancy",
  },
  {
    id: "panel-opacity",
    section: "appearance",
    label: "Panel transparency",
    keywords: "composer dialog modal menu popup settings card translucent opacity",
  },
  {
    id: "blur",
    section: "appearance",
    label: "Blur radius",
    keywords: "glass translucent vibrancy backdrop",
  },
  {
    id: "main-pane-glass",
    section: "appearance",
    label: "Main pane glass",
    keywords: "translucent transparency body window",
  },
  {
    id: "interface-scale",
    section: "appearance",
    label: "Interface scale",
    keywords: "zoom font size bigger smaller ui",
  },
  {
    id: "show-excluded-files",
    section: "appearance",
    label: "Show excluded files",
    keywords: "explorer gitignore ignored hidden files tree",
  },
  {
    id: "chat-background",
    section: "appearance",
    label: "Chat background",
    keywords: "wallpaper image picture opacity backdrop",
  },
  {
    id: "transcript-layout",
    section: "chat",
    label: "Transcript layout",
    keywords: "full width chat bubble message",
  },
  {
    id: "anchor-prompts",
    section: "chat",
    label: "Anchor prompts to top",
    keywords: "scroll position sticky message",
  },
  {
    id: "follow-up",
    section: "chat",
    label: "Follow-up behavior",
    keywords: "queue steer interrupt send while running",
  },
  {
    id: "model-controls",
    section: "chat",
    label: "Model controls",
    keywords:
      "effort thinking reasoning fast service tier model picker composer",
  },
  {
    id: "format-on-save",
    section: "chat",
    label: "Format on save",
    keywords: "prettier quotes editor save format",
  },
  {
    id: "diff-view",
    section: "chat",
    label: "Diff view",
    keywords: "unified editor review changes working tree",
  },
  {
    id: "native-auto-sync",
    section: "import",
    label: "Keep imports synced",
    keywords: "auto sync automatic refresh live watch 自动同步",
  },
  {
    id: "native-sessions",
    section: "import",
    label: "Import from other AI apps",
    keywords:
      "codex pi import history synchronization sync resume native 导入 同步 会话 历史",
  },
  {
    id: "agent-clis",
    section: "providers",
    label: "Agent CLIs",
    keywords:
      "codex opencode cursor grok pi omp fx hermes antigravity binary path",
  },
  {
    id: "provider-accounts",
    section: "providers",
    label: "Provider accounts",
    keywords:
      "codex claude account sign in login rename remove delete credentials profile data home CODEX_HOME CLAUDE_CONFIG_DIR usage limit quota exhausted 账号 数据目录",
  },
  {
    id: "show-remaining-usage",
    section: "providers",
    label: "Show remaining usage",
    keywords: "usage limit meter bar left used quota percent",
  },
  {
    id: "mask-emails",
    section: "providers",
    label: "Mask account emails",
    keywords: "email privacy blur hide screenshot account",
  },
  {
    id: "claude-hooks",
    section: "providers",
    label: "Claude Code hooks",
    keywords: "pretooluse settings.json block command notification",
  },
  {
    id: "project-notifications",
    section: "inbox",
    label: "Project notifications",
    keywords: "mute resume sounds banners reminders categories",
  },
  {
    id: "github",
    section: "inbox",
    label: "GitHub",
    keywords: "gh cli connect pull request sign in",
  },
  {
    id: "gitlab",
    section: "inbox",
    label: "GitLab",
    keywords: "token self-managed merge request connect",
  },
  {
    id: "azuredevops",
    section: "inbox",
    label: "ADO",
    keywords: "azure devops boards repos pull request pat organization connect",
  },
  {
    id: "jira",
    section: "inbox",
    label: "Jira",
    keywords: "atlassian cloud site email api token issues projects connect",
  },
  {
    id: "linear",
    section: "inbox",
    label: "Linear",
    keywords: "api key issues teams connect",
  },
  {
    id: "show-archived",
    section: "archive",
    label: "Show archived in the sidebar",
    keywords: "hidden conversations list",
  },
];

export type SettingsSearchResult = {
  section: SettingsSectionId;
  sectionLabel: string;
  /** Row to scroll to, or `null` when the whole section matched. */
  settingId: string | null;
  label: string;
};

/** Ranks a label/keyword pair against a lowercased needle; `null` means no match. */
function matchScore(
  needle: string,
  label: string,
  keywords?: string,
): number | null {
  const lower = label.toLowerCase();
  if (lower.startsWith(needle)) return 0;
  if (lower.includes(needle)) return 1;
  if (keywords?.toLowerCase().includes(needle)) return 2;
  return null;
}

/** Individual settings first, then whole sections, so a row wins its own name. */
export function searchSettings(
  query: string,
  limit = 8,
): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { score: number; result: SettingsSearchResult }[] = [];

  for (const entry of SETTINGS_INDEX) {
    const scores = [
      matchScore(needle, entry.label, entry.keywords),
      matchScore(
        needle,
        translate(entry.label, undefined, "zh-CN"),
        entry.keywords,
      ),
    ].filter((score): score is number => score !== null);
    const score = scores.length ? Math.min(...scores) : null;
    if (score == null) continue;
    scored.push({
      score,
      result: {
        section: entry.section,
        sectionLabel: settingsSectionLabel(entry.section),
        settingId: entry.id,
        label: translate(entry.label),
      },
    });
  }

  for (const section of SETTINGS_SECTIONS) {
    const scores = [
      matchScore(
        needle,
        section.label,
        `${section.description} ${section.keywords ?? ""}`,
      ),
      matchScore(
        needle,
        translate(section.label, undefined, "zh-CN"),
        `${translate(section.description, undefined, "zh-CN")} ${section.keywords ?? ""}`,
      ),
    ].filter((score): score is number => score !== null);
    const score = scores.length ? Math.min(...scores) : null;
    if (score == null) continue;
    scored.push({
      score: score + 0.5,
      result: {
        section: section.id,
        sectionLabel: translate(section.label),
        settingId: null,
        label: translate(section.label),
      },
    });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score || a.result.label.localeCompare(b.result.label),
    )
    .slice(0, limit)
    .map((item) => item.result);
}

export const SETTINGS_SECTION_DEFAULT: SettingsSectionId = "general";

export function isSettingsSectionId(
  value: unknown,
): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function settingsSectionLabel(id: SettingsSectionId): string {
  return translate(
    SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? "General",
  );
}

export function settingsSectionDescription(id: SettingsSectionId): string {
  return translate(
    SETTINGS_SECTIONS.find((section) => section.id === id)?.description ?? "",
  );
}

export function loadSettingsSection(): SettingsSectionId {
  try {
    const raw = preferenceStorage.getItem(SECTION_KEY);
    return isSettingsSectionId(raw) ? raw : SETTINGS_SECTION_DEFAULT;
  } catch {
    return SETTINGS_SECTION_DEFAULT;
  }
}

export function saveSettingsSection(id: SettingsSectionId) {
  try {
    preferenceStorage.setItem(SECTION_KEY, id);
  } catch {
    // private mode / quota
  }
}


const FOLLOW_UP_BEHAVIOR_KEY = "omnicode.followUpBehavior";

const COMPOSER_EFFORT_VISIBLE_KEY = "omnicode.composerEffortVisible";

const MODEL_CONTROLS_KEY = "omnicode.modelControls";

const FILE_TAB_MODE_KEY = "omnicode.fileTabMode";

const TAB_ANIMATIONS_ENABLED_KEY = "omnicode.tabAnimationsEnabled";

export type FollowUpBehavior = "steer" | "queue";

export const FOLLOW_UP_BEHAVIOR_DEFAULT: FollowUpBehavior = "steer";

export function loadFollowUpBehavior(): FollowUpBehavior {
  try {
    const raw = preferenceStorage.getItem(FOLLOW_UP_BEHAVIOR_KEY);
    return raw === "queue" || raw === "steer"
      ? raw
      : FOLLOW_UP_BEHAVIOR_DEFAULT;
  } catch {
    return FOLLOW_UP_BEHAVIOR_DEFAULT;
  }
}

export function saveFollowUpBehavior(value: FollowUpBehavior) {
  try {
    preferenceStorage.setItem(FOLLOW_UP_BEHAVIOR_KEY, value);
  } catch {
    // private mode / quota
  }
}

export type FileTabMode = "pane" | "workspace";

export const FILE_TAB_MODE_DEFAULT: FileTabMode = "pane";

/** Default conversation layout; legacy values remain compatible with saved preferences. */
export function loadFileTabMode(): FileTabMode {
  try {
    const raw = preferenceStorage.getItem(FILE_TAB_MODE_KEY);
    return raw === "pane" || raw === "workspace" ? raw : FILE_TAB_MODE_DEFAULT;
  } catch {
    return FILE_TAB_MODE_DEFAULT;
  }
}

export function saveFileTabMode(value: FileTabMode) {
  try {
    preferenceStorage.setItem(FILE_TAB_MODE_KEY, value);
  } catch {
    // private mode / quota
  }
}

export const TAB_ANIMATIONS_ENABLED_DEFAULT = true;

export function loadTabAnimationsEnabled(): boolean {
  return readFlag(TAB_ANIMATIONS_ENABLED_KEY) ?? TAB_ANIMATIONS_ENABLED_DEFAULT;
}

export function saveTabAnimationsEnabled(value: boolean) {
  writeFlag(TAB_ANIMATIONS_ENABLED_KEY, value);
}

export type ModelControls = "menu" | "beside";

export const MODEL_CONTROLS_DEFAULT: ModelControls = "beside";

/** Fired on `window` when the composer model controls setting flips. */
export const MODEL_CONTROLS_CHANGE_EVENT = "omnicode:model-controls-change";

export function loadModelControls(): ModelControls {
  try {
    const raw = preferenceStorage.getItem(MODEL_CONTROLS_KEY);
    if (raw === "menu" || raw === "beside") return raw;
    if (raw == null) {
      // Migrate the previous effort-control toggle: on means beside the picker.
      const legacy = preferenceStorage.getItem(COMPOSER_EFFORT_VISIBLE_KEY);
      if (legacy === "1" || legacy === "true") return "beside";
      if (legacy === "0" || legacy === "false") return "menu";
    }
  } catch {
    // private mode / quota
  }
  return MODEL_CONTROLS_DEFAULT;
}

export function saveModelControls(value: ModelControls) {
  try {
    preferenceStorage.setItem(MODEL_CONTROLS_KEY, value);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ModelControls>(MODEL_CONTROLS_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeModelControls(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MODEL_CONTROLS_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(MODEL_CONTROLS_CHANGE_EVENT, onStoreChange);
}

const NOTES_ENABLED_KEY = "omnicode.notesEnabled";

export const NOTES_ENABLED_DEFAULT = true;

/** Fired on `window` when the Notes UI setting flips. */
export const NOTES_ENABLED_CHANGE_EVENT = "omnicode:notes-enabled-change";

export function loadNotesEnabled(): boolean {
  return readFlag(NOTES_ENABLED_KEY) ?? NOTES_ENABLED_DEFAULT;
}

export function saveNotesEnabled(value: boolean) {
  writeFlag(NOTES_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(NOTES_ENABLED_CHANGE_EVENT, { detail: value }),
  );
}

export function subscribeNotesEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NOTES_ENABLED_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(NOTES_ENABLED_CHANGE_EVENT, onStoreChange);
}

const QUICK_COMPOSER_ENABLED_KEY = "omnicode.quickComposerEnabled";
const QUICK_COMPOSER_SHORTCUT_KEY = "omnicode.quickComposerShortcut";

export const QUICK_COMPOSER_ENABLED_DEFAULT = true;

export function loadQuickComposerEnabled(): boolean {
  return readFlag(QUICK_COMPOSER_ENABLED_KEY) ?? QUICK_COMPOSER_ENABLED_DEFAULT;
}

export function saveQuickComposerEnabled(value: boolean) {
  writeFlag(QUICK_COMPOSER_ENABLED_KEY, value);
}

export function loadQuickComposerShortcut(): string {
  try {
    const value = preferenceStorage.getItem(QUICK_COMPOSER_SHORTCUT_KEY);
    return value && isGlobalShortcut(value)
      ? value
      : QUICK_COMPOSER_DEFAULT_SHORTCUT;
  } catch {
    return QUICK_COMPOSER_DEFAULT_SHORTCUT;
  }
}

export function saveQuickComposerShortcut(value: string) {
  if (!isGlobalShortcut(value)) return;
  // Same conflict rules as every other row, so the separately stored Quick
  // Composer chord cannot claim a combination another command already owns.
  const shortcut = validateKeybindingShortcut(QUICK_COMPOSER_COMMAND, value);
  try {
    preferenceStorage.setItem(QUICK_COMPOSER_SHORTCUT_KEY, shortcut);
  } catch {
    // private mode / quota
  }
}

const LIVE_AGENTS_ENABLED_KEY = "omnicode.liveAgentsEnabled";

export const LIVE_AGENTS_ENABLED_DEFAULT = true;

/** Fired on `window` when the working-agents rail card setting flips. */
export const LIVE_AGENTS_ENABLED_CHANGE_EVENT =
  "omnicode:live-agents-enabled-change";

export function loadLiveAgentsEnabled(): boolean {
  return readFlag(LIVE_AGENTS_ENABLED_KEY) ?? LIVE_AGENTS_ENABLED_DEFAULT;
}

export function saveLiveAgentsEnabled(value: boolean) {
  writeFlag(LIVE_AGENTS_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(LIVE_AGENTS_ENABLED_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeLiveAgentsEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LIVE_AGENTS_ENABLED_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(LIVE_AGENTS_ENABLED_CHANGE_EVENT, onStoreChange);
}

const CLOSE_TO_TRAY_KEY = "omnicode.closeToTray";

export const CLOSE_TO_TRAY_DEFAULT = true;

export function loadCloseToTray(): boolean {
  // macOS keeps the Dock instead; only Windows and Linux install a tray icon.
  if (!IS_WIN && !IS_LINUX) return false;
  return readFlag(CLOSE_TO_TRAY_KEY) ?? CLOSE_TO_TRAY_DEFAULT;
}

export function saveCloseToTray(value: boolean) {
  writeFlag(CLOSE_TO_TRAY_KEY, value);
}

const DIFF_VIEWER_KEY = "omnicode.diffViewer";

export type DiffViewer = "editor" | "unified";

export const DIFF_VIEWER_DEFAULT: DiffViewer = "editor";

/** Fired on `window` when the working-tree diff layout flips. */
export const DIFF_VIEWER_CHANGE_EVENT = "omnicode:diff-viewer-change";

function isDiffViewer(value: unknown): value is DiffViewer {
  return value === "editor" || value === "unified";
}

export function loadDiffViewer(): DiffViewer {
  try {
    const raw = preferenceStorage.getItem(DIFF_VIEWER_KEY);
    return isDiffViewer(raw) ? raw : DIFF_VIEWER_DEFAULT;
  } catch {
    return DIFF_VIEWER_DEFAULT;
  }
}

export function saveDiffViewer(value: DiffViewer) {
  const next = isDiffViewer(value) ? value : DIFF_VIEWER_DEFAULT;
  try {
    preferenceStorage.setItem(DIFF_VIEWER_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DiffViewer>(DIFF_VIEWER_CHANGE_EVENT, { detail: next }),
  );
}

export function subscribeDiffViewer(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DIFF_VIEWER_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(DIFF_VIEWER_CHANGE_EVENT, onStoreChange);
}

const FORMAT_ON_SAVE_KEY = "omnicode.formatOnSave";

export const FORMAT_ON_SAVE_DEFAULT = true;

export function loadFormatOnSave(): boolean {
  return readFlag(FORMAT_ON_SAVE_KEY) ?? FORMAT_ON_SAVE_DEFAULT;
}

export function saveFormatOnSave(value: boolean) {
  writeFlag(FORMAT_ON_SAVE_KEY, value);
}

const AUTOSAVE_KEY = "omnicode.autosave";
const AUTOSAVE_CHANGE_EVENT = "omnicode:autosave-change";

export const AUTOSAVE_DEFAULT = false;

export function loadAutosave(): boolean {
  return readFlag(AUTOSAVE_KEY) ?? AUTOSAVE_DEFAULT;
}

export function saveAutosave(value: boolean): boolean {
  writeFlag(AUTOSAVE_KEY, value);
  const saved = loadAutosave();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTOSAVE_CHANGE_EVENT));
  }
  return saved;
}

export function subscribeAutosave(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTOSAVE_KEY) onStoreChange();
  };
  window.addEventListener(AUTOSAVE_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTOSAVE_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

const MENU_BAR_VISIBLE_KEY = "omnicode.menuBarVisible";
const MENU_BAR_CHANGE_EVENT = "omnicode:menu-bar-change";

/** Windows/Linux in-window menu bar; hidden means it appears on an Alt tap. */
export function loadMenuBarVisible(): boolean {
  return readFlag(MENU_BAR_VISIBLE_KEY) ?? false;
}

export function saveMenuBarVisible(value: boolean): boolean {
  writeFlag(MENU_BAR_VISIBLE_KEY, value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MENU_BAR_CHANGE_EVENT));
  }
  return loadMenuBarVisible();
}

export function subscribeMenuBarVisible(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === MENU_BAR_VISIBLE_KEY) onStoreChange();
  };
  window.addEventListener(MENU_BAR_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MENU_BAR_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

const CLAUDE_HOOKS_KEY = "omnicode.claudeHooks";

export const CLAUDE_HOOKS_DEFAULT = true;

export function loadClaudeHooks(): boolean {
  return readFlag(CLAUDE_HOOKS_KEY) ?? CLAUDE_HOOKS_DEFAULT;
}

export function saveClaudeHooks(value: boolean) {
  writeFlag(CLAUDE_HOOKS_KEY, value);
}

const CTRL = IS_MAC ? "⌃" : "Ctrl+";

export type KeybindingRow = {
  command: string;
  keys: string;
  when: string;
};

/**
 * Mirrors the bindings we actually handle: the native menu accelerators in
 * `src-tauri/src/menu.rs`, `tabCommand`, the window key handler in App, and
 * focused surface handlers such as the draft composer workspace toggle.
 */
export const KEYBINDINGS: KeybindingRow[] = [
  { command: "App: Settings", keys: `${MOD},`, when: "Always" },
  { command: "App: Search", keys: `${MOD}K`, when: "Always" },
  { command: "App: Go to File", keys: `${MOD}P`, when: "Always" },
  { command: "App: Command Palette", keys: `${MOD}${SHIFT}P`, when: "Always" },
  { command: "App: Find in Files", keys: `${MOD}${SHIFT}F`, when: "Always" },
  { command: "App: Open Project", keys: `${MOD}O`, when: "Always" },
  { command: "App: New Window", keys: `${MOD}${SHIFT}N`, when: "Always" },
  ...(IS_MAC
    ? [
        {
          command: "App: Quick Composer",
          keys: `${MOD}${SHIFT}Space`,
          when: "Anywhere",
        },
      ]
    : []),
  { command: "App: Toggle Sidebar", keys: `${MOD}B`, when: "Always" },
  { command: "App: Switch Model", keys: `${MOD}.`, when: "Always" },
  {
    command: "Composer: Toggle Workspace",
    keys: `${MOD}${SHIFT}G`,
    when: "Draft session composer",
  },
  { command: "View: Reload", keys: `${MOD}${SHIFT}R`, when: "Always" },
  { command: "View: Zoom In", keys: `${MOD}+`, when: "Always" },
  { command: "View: Zoom Out", keys: `${MOD}-`, when: "Always" },
  { command: "View: Reset Zoom", keys: `${MOD}0`, when: "Always" },
  { command: "Tab: New", keys: `${MOD}T`, when: "Always" },
  { command: "Tab: Close Others", keys: `${MOD}${ALT}T`, when: "Always" },
  { command: "Tab: Close All", keys: `${MOD}${SHIFT}W`, when: "Always" },
  { command: "Tab: Next", keys: `${MOD}${SHIFT}]`, when: "Always" },
  { command: "Tab: Previous", keys: `${MOD}${SHIFT}[`, when: "Always" },
  { command: "Tab: Cycle Next", keys: `${CTRL}Tab`, when: "Always" },
  {
    command: "Tab: Cycle Previous",
    keys: `${CTRL}${SHIFT}Tab`,
    when: "Always",
  },
  { command: "Tab: Back", keys: `${MOD}[`, when: "Always" },
  { command: "Tab: Forward", keys: `${MOD}]`, when: "Always" },
  { command: "Tab: Activate 1–8", keys: `${MOD}1 … ${MOD}8`, when: "Always" },
  { command: "Tab: Activate Last", keys: `${MOD}9`, when: "Always" },
  {
    command: "Session: Archive",
    keys: `${MOD}${SHIFT}A`,
    when: "sessionFocus && !overlay",
  },
  {
    command: "Session: Previous",
    keys: `${MOD}${SHIFT}↑`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Next",
    keys: `${MOD}${SHIFT}↓`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Previous in Current Tab",
    keys: `${MOD}↑`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Next in Current Tab",
    keys: `${MOD}↓`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Previous",
    keys: `${MOD}${SHIFT}←`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Next",
    keys: `${MOD}${SHIFT}→`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  { command: "Pane: Close", keys: `${MOD}W`, when: "Always" },
  { command: "Pane: Split Right", keys: `${MOD}D`, when: "!editorFocus" },
  {
    command: "Pane: Split Down",
    keys: `${MOD}${SHIFT}D`,
    when: "!editorFocus",
  },
  { command: "Pane: Focus Left", keys: `${MOD}${ALT}←`, when: "Always" },
  { command: "Pane: Focus Right", keys: `${MOD}${ALT}→`, when: "Always" },
  { command: "Pane: Focus Up", keys: `${MOD}${ALT}↑`, when: "Always" },
  { command: "Pane: Focus Down", keys: `${MOD}${ALT}↓`, when: "Always" },
  { command: "Terminal: New", keys: `${MOD}\``, when: "Always" },
  { command: "Terminal: New Tab", keys: `${MOD}${SHIFT}\``, when: "Always" },
  { command: "Terminal: Toggle Dock", keys: `${MOD}J`, when: "Always" },
  { command: "Editor: Find", keys: `${MOD}F`, when: "editorFocus" },
  { command: "Editor: Replace", keys: `${MOD}${ALT}F`, when: "editorFocus" },
];

const KEYBINDING_OVERRIDES_KEY = "omnicode.keybindingOverrides";
const KEYBINDINGS_CHANGE_EVENT = "omnicode:keybindings-change";

export type KeybindingOverride = {
  disabled?: boolean;
  shortcut?: string;
};

export type KeybindingOverrides = Record<string, KeybindingOverride>;

const VALID_COMMANDS = new Set(KEYBINDINGS.map((row) => row.command));

const KEY_CODES: Record<string, string> = {
  " ": "Space",
  Enter: "Enter",
  Space: "Space",
  Tab: "Tab",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  ",": "Comma",
  ".": "Period",
  "+": "Equal",
  "-": "Minus",
  "\\": "Backslash",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
};

const DISPLAY_MODIFIERS: [string, string][] = IS_MAC
  ? [
      ["⌘", "Command"],
      ["⌃", "Control"],
      ["⌥", "Option"],
      ["⇧", "Shift"],
    ]
  : [
      ["Ctrl+", "Control"],
      ["Alt+", "Option"],
      ["Shift+", "Shift"],
    ];

const QUICK_COMPOSER_COMMAND = "App: Quick Composer";
const ACTIVATE_RANGE_COMMAND = "Tab: Activate 1–8";

/**
 * Every chord a command owns by default, in stored form. Grouped rows expand
 * to one chord per key so a rebind can never shadow a working shortcut.
 */
function defaultShortcutsFor(command: string): string[] {
  const row = KEYBINDINGS.find((entry) => entry.command === command);
  if (!row) return [];
  let rest = row.keys;
  const modifiers: string[] = [];
  for (const [display, modifier] of DISPLAY_MODIFIERS) {
    if (rest.startsWith(display)) {
      modifiers.push(modifier);
      rest = rest.slice(display.length);
    }
  }
  const chords = (code: string) => {
    const value = canonicalShortcut(
      modifiers.length ? [...modifiers, code].join("+") : code,
    );
    return value ? [value] : [];
  };
  if (row.keys.includes("…")) {
    return [1, 2, 3, 4, 5, 6, 7, 8].flatMap((digit) => chords(`Digit${digit}`));
  }
  if (/^[A-Za-z]$/.test(rest)) return chords(`Key${rest.toUpperCase()}`);
  if (/^[0-9]$/.test(rest)) return chords(`Digit${rest}`);
  if (KEY_CODES[rest]) return chords(KEY_CODES[rest]);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(rest)) return chords(rest);
  return [];
}

/** Chord to owning command, covering defaults, live overrides and Quick Composer. */
function shortcutOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const row of KEYBINDINGS) {
    // The Quick Composer chord is stored separately from the table.
    const chords =
      row.command === QUICK_COMPOSER_COMMAND
        ? [loadQuickComposerShortcut()]
        : defaultShortcutsFor(row.command);
    for (const chord of chords) owners.set(chord, row.command);
  }
  for (const [command, override] of Object.entries(loadKeybindingOverrides())) {
    if (override.shortcut) owners.set(override.shortcut, command);
  }
  return owners;
}

function validateShortcut(command: string, shortcut: string): string {
  const canonical = canonicalShortcut(shortcut);
  if (!canonical) throw new Error("That combination is not a valid shortcut");
  if (command === ACTIVATE_RANGE_COMMAND && !/Digit[1-8]$/.test(canonical)) {
    throw new Error("Tab: Activate 1–8 needs a number key from 1 to 8");
  }
  return canonical;
}

/** Shared by both save paths so no chord can be claimed twice. */
export function validateKeybindingShortcut(
  command: string,
  shortcut: string,
): string {
  const canonical = validateShortcut(command, shortcut);
  const owner = shortcutOwners().get(canonical);
  if (owner && owner !== command) {
    throw new Error(`Already used by ${owner}`);
  }
  return canonical;
}

let cacheStorage: Pick<Storage, "getItem"> | null = null;
let cacheRaw: string | null = null;
let cacheValue: KeybindingOverrides = {};

function parseKeybindingOverrides(raw: string | null): KeybindingOverrides {
  const value = JSON.parse(raw ?? "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: KeybindingOverrides = {};
  for (const [command, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!VALID_COMMANDS.has(command) || !entry || typeof entry !== "object")
      continue;
    const override = entry as { disabled?: unknown; shortcut?: unknown };
    const disabled = override.disabled === true;
    const shortcut =
      typeof override.shortcut === "string"
        ? (canonicalShortcut(override.shortcut) ?? undefined)
        : undefined;
    if (shortcut) next[command] = { shortcut };
    else if (disabled) next[command] = { disabled: true };
  }
  // A session-sidebar rebind expresses the user's choice for the remaining
  // sidebar. Apply it last so it wins over the former project-rail command,
  // regardless of JSON entry order. Never carry its disabled state forward.
  const legacy = (value as Record<string, unknown>)[
    "App: Toggle Session Sidebar"
  ];
  if (legacy && typeof legacy === "object") {
    const override = legacy as { disabled?: unknown; shortcut?: unknown };
    if (override.disabled !== true && typeof override.shortcut === "string") {
      const shortcut = canonicalShortcut(override.shortcut);
      if (shortcut) next["App: Toggle Sidebar"] = { shortcut };
    }
  }
  return next;
}

/** Cached per raw value: this runs several times on every keydown. Returns a fresh object. */
export function loadKeybindingOverrides(): KeybindingOverrides {
  try {
    const storage = preferenceStorage;
    const raw = storage.getItem(KEYBINDING_OVERRIDES_KEY);
    if (cacheStorage === storage && cacheRaw === raw) return { ...cacheValue };
    const next = parseKeybindingOverrides(raw);
    cacheStorage = storage;
    cacheRaw = raw;
    cacheValue = next;
    return { ...next };
  } catch {
    return {};
  }
}

export function saveKeybindingOverride(
  command: string,
  override: KeybindingOverride,
): KeybindingOverrides {
  const next = loadKeybindingOverrides();
  if (override.disabled) next[command] = { disabled: true };
  else if (override.shortcut) {
    const shortcut = validateKeybindingShortcut(command, override.shortcut);
    next[command] = { shortcut };
  } else delete next[command];
  try {
    if (Object.keys(next).length) {
      preferenceStorage.setItem(KEYBINDING_OVERRIDES_KEY, JSON.stringify(next));
    } else {
      preferenceStorage.removeItem(KEYBINDING_OVERRIDES_KEY);
    }
  } catch {
    throw new Error("Could not save shortcuts");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(KEYBINDINGS_CHANGE_EVENT));
  }
  return next;
}

export type ShortcutEvent = Pick<KeyboardEvent, "code"> &
  Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function shortcutMatches(
  shortcut: string,
  event: ShortcutEvent,
): boolean {
  // Copy the fields: real keyboard events expose modifiers as prototype
  // accessors, so spreading the event would silently drop all of them.
  return (
    shortcutFromKeyEvent({
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    }) === shortcut
  );
}

export function matchCustomKeybinding(event: ShortcutEvent): string | null {
  for (const [command, override] of Object.entries(loadKeybindingOverrides())) {
    if (override.shortcut && shortcutMatches(override.shortcut, event)) {
      return command;
    }
  }
  return null;
}

export function keybindingPressed(
  command: string,
  event: ShortcutEvent,
  defaultMatch: boolean,
): boolean {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return false;
  if (override?.shortcut) return shortcutMatches(override.shortcut, event);
  return defaultMatch;
}

export function keybindingShortcutLabel(
  command: string,
  fallback: string,
): string | null {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return null;
  return override?.shortcut
    ? quickComposerShortcutLabel(override.shortcut)
    : fallback;
}

export function keybindingShortcutTokens(
  command: string,
  fallback: string,
): string | null {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return null;
  return override?.shortcut ? shortcutTokens(override.shortcut) : fallback;
}

export function subscribeKeybindings(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEYBINDING_OVERRIDES_KEY) onStoreChange();
  };
  window.addEventListener(KEYBINDINGS_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(KEYBINDINGS_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function currentKeybindings(): KeybindingRow[] {
  const overrides = loadKeybindingOverrides();
  return KEYBINDINGS.map((row) => {
    if (row.command === "App: Quick Composer") {
      return {
        ...row,
        keys: loadQuickComposerEnabled()
          ? quickComposerShortcutLabel(loadQuickComposerShortcut())
          : "Disabled",
      };
    }
    const override = overrides[row.command];
    return {
      ...row,
      keys: override?.disabled
        ? "Disabled"
        : override?.shortcut
          ? quickComposerShortcutLabel(override.shortcut)
          : row.keys,
    };
  });
}

export function filterKeybindings(
  rows: KeybindingRow[],
  query: string,
): KeybindingRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.command.toLowerCase().includes(needle) ||
      translate(row.command, undefined, "zh-CN")
        .toLowerCase()
        .includes(needle) ||
      row.keys.toLowerCase().includes(needle) ||
      row.when.toLowerCase().includes(needle) ||
      translate(row.when, undefined, "zh-CN").toLowerCase().includes(needle),
  );
}
