import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { AnimatePresence, animate } from "motion/react";
import { panelTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { SurfaceAppearance } from "../../../shared/ui/SurfaceAppearance";
import { windowDragRegion } from "../../../app/shell/startWindowDrag";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ConnectionsPage } from "../../connections/ui/ConnectionsPage";
import {
  RotateCcw,
} from "../../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Popover } from "../../../shared/ui/Popover";
import { NativeSessionsPanel } from "./NativeSessionsPanel";
import { McpSettings } from "./McpSettings";
import { SettingsNav } from "../../../app/shell/SettingsRail";
import { SettingsSearchInput } from "../../workflows/kit/settings/SettingsSearchInput";
import {
} from "../../workflows/kit/settings/SettingsPageParts";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  type RecentProject,
} from "../../projects/model/recents";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  searchSettings,
  settingsSectionDescription,
  settingsSectionLabel,
  type SettingsSearchResult,
  type SettingsSectionId,
} from "../model/settings";
import { SkillsPage } from "../../skills/ui/SkillsPage";
import { WorktreesPage } from "../../source-control/ui/WorktreesPage";
import {
  removeWorktree,
  type RemoveWorktree,
} from "../../source-control/model/worktrees";
import type { Session } from "../../sessions/model/session";
import { scrollWithin } from "../../../shared/lib/scrollWithin";
import { useAppearanceSettings } from "./pages/appearance/useAppearanceSettings";
import { PageHeader, RevealedSetting, settingDomId, SettingsPage } from "./settingsLayout";
import { GeneralPage } from "./pages/GeneralPage";
import { AppearancePage } from "./pages/appearance/AppearancePage";
import { ChatPage } from "./pages/ChatPage";
import { KeybindingsPage } from "./pages/KeybindingsPage";
import { ProvidersPage } from "./pages/providers/ProvidersPage";
import { InboxPage } from "./pages/InboxPage";
import { ArchivePage } from "./pages/ArchivePage";

/**
 * The `data-setting-id` Settings should reveal when it opens: one of the ids in
 * `SETTINGS_INDEX`. Inbox integrations pass their provider id.
 */
export type SettingsAnchor = string;

type Props = {
  section: SettingsSectionId;
  /** Hidden or unfocused workspace views must not consume global shortcuts. */
  active?: boolean;
  /** Card to scroll to; the General page is too long to land at the top. */
  anchor?: SettingsAnchor | null;
  /** Project to focus when opening notification settings from a quick action. */
  notificationProjectPath?: string | null;
  /** Changes for each quick action, including repeated requests for one project. */
  notificationSettingsRequest?: number;
  recents?: RecentProject[];
  cwd: string;
  sessions: SessionSummary[];
  liveSessions?: Session[];
  onRemoveWorktree?: RemoveWorktree;
  onCheckWorktreeRemoval?: RemoveWorktree;
  onDeleteWorktreeSessions?: (
    sessionIds: readonly string[],
  ) => Promise<boolean>;
  onClose: () => void;
  /** Lets search jump to a setting that lives on another page. */
  onSelectSection?: (section: SettingsSectionId) => void;
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
  onOpenWhatsNew: (version: string) => void;
};

export function SettingsView({
  section: requestedSection,
  active = true,
  anchor = null,
  notificationProjectPath = null,
  notificationSettingsRequest = 0,
  recents,
  cwd,
  sessions,
  liveSessions,
  onRemoveWorktree = removeWorktree,
  onCheckWorktreeRemoval,
  onDeleteWorktreeSessions,
  onClose,
  onSelectSection,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
  onOpenWhatsNew,
}: Props) {
  const { t: uiT } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const reduced = useMotionPreference();
  const [section, setSection] = useState(requestedSection);
  const [revealed, setRevealed] = useState<string | null>(anchor);
  const pageVisit = useRef({ section, generation: 0 });
  if (pageVisit.current.section !== section) pageVisit.current = { section, generation: pageVisit.current.generation + 1 };
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings();

  useEffect(() => setSection(requestedSection), [requestedSection]);

  const selectSection = useCallback(
    (next: SettingsSectionId) => {
      setSection(next);
      onSelectSection?.(next);
    },
    [onSelectSection],
  );

  useEffect(() => setRevealed(anchor), [anchor, notificationSettingsRequest]);

  // Section is a dependency so a search result on another page scrolls once
  // that page has mounted the row.
  useEffect(() => {
    if (!revealed) return;
    // A project quick action lets the project card focus itself after discovery.
    if (!(revealed === "project-notifications" && notificationProjectPath)) {
      scrollWithin(document.getElementById(settingDomId(revealed)), "center");
    }
    const element = document.getElementById(settingDomId(revealed));
    if (!element || reduced) { setRevealed(null); return; }
    const previous = element.style.backgroundColor;
    const controls = animate(element, {
      backgroundColor: [getComputedStyle(element).backgroundColor, "transparent"],
    }, { ...panelTransition, onComplete: () => {
      element.style.backgroundColor = previous;
      setRevealed((current) => current === revealed ? null : current);
    } });
    return () => { controls.stop(); element.style.backgroundColor = previous; };
  }, [revealed, section, notificationProjectPath, notificationSettingsRequest, reduced]);

  const onReveal = useCallback(
    (next: SettingsSectionId, settingId: string | null) => {
      if (next !== section) selectSection(next);
      setRevealed(settingId);
    },
    [selectSection, section],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    // Let dialogs and other Settings controls handle Escape first.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <SurfaceAppearance.Provider value="settings">
    <div
      role="region"
      aria-label={uiT("Settings")}
      data-app-settings
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        {...windowDragRegion()}
        className="desktop-toolbar flex h-10 shrink-0 select-none items-center border-b border-stroke"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <span className="shrink-0 text-content/45">{uiT("Settings")}</span>
          <span aria-hidden className="shrink-0 text-content/25">
            /
          </span>
          <span className="min-w-0 truncate text-content">
            {settingsSectionLabel(section)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          {section === "appearance" ? (
            <button
              type="button"
              onClick={appearance.restoreDefaults}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/6 hover:text-content"
            >
              <RotateCcw className="size-3.5" />
              {uiT("Restore defaults")}
            </button>
          ) : null}
          <SettingsSearch onReveal={onReveal} />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <SettingsNav section={section} onSelect={selectSection} />
        <div className="desktop-card settings-panel m-3 ml-1 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-stroke">
          {section === "skills" ? (
            <SkillsPage
              key={cwd}
              cwd={cwd}
              agentPicker={(props) => (
                <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52" label={uiT("Filter skills by agent")} {...props} />
              )}
              header={
                <PageHeader
                  title={settingsSectionLabel(section)}
                  description={settingsSectionDescription(section)}
                />
              }
            />
          ) : (
            <RevealedSetting.Provider value={revealed}>
              <div
                ref={lockOverscroll}
                className="@container/settings min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
              >
                <div data-settings-content className="relative mx-auto w-full max-w-4xl px-5 py-6 pb-16 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8">
                  <AnimatePresence mode="popLayout">
                    <SettingsPage key={`${section}:${pageVisit.current.generation}`} reduced={reduced}>
                  <PageHeader
                    title={settingsSectionLabel(section)}
                    description={settingsSectionDescription(section)}
                  />
                  {section === "general" ? (
                    <GeneralPage onOpenWhatsNew={onOpenWhatsNew} />
                  ) : null}
                  {section === "connections" ? (
                    <ConnectionsPage revealed={revealed} />
                  ) : null}
                  {section === "appearance" ? (
                    <AppearancePage appearance={appearance} />
                  ) : null}
                  {section === "chat" ? <ChatPage /> : null}
                  {section === "keybindings" ? <KeybindingsPage /> : null}
                  {section === "import" ? (
                    <NativeSessionsPanel onOpenSession={onOpenSession} />
                  ) : null}
                  {section === "mcp" ? (
                    <McpSettings cwd={cwd} recents={recents} />
                  ) : null}
                  {section === "providers" ? (
                    <ProvidersPage cwd={cwd} recents={recents} />
                  ) : null}
                  {section === "worktrees" ? (
                    <WorktreesPage
                      cwd={cwd}
                      recents={recents}
                      liveSessions={liveSessions}
                      onRemove={onRemoveWorktree}
                      onCheckRemove={onCheckWorktreeRemoval}
                      onDeleteSessions={onDeleteWorktreeSessions}
                    />
                  ) : null}
                  {section === "inbox" ? (
                    <InboxPage
                      cwd={cwd}
                      recents={recents}
                      notificationProjectPath={notificationProjectPath}
                      notificationSettingsRequest={notificationSettingsRequest}
                    />
                  ) : null}
                  {section === "archive" ? (
                    <ArchivePage
                      cwd={cwd}
                      sessions={sessions}
                      onOpenSession={onOpenSession}
                      onArchiveSession={onArchiveSession}
                      onDeleteSession={onDeleteSession}
                      onRestoreProject={onRestoreProject}
                      onDeleteProject={onDeleteProject}
                    />
                  ) : null}
                    </SettingsPage>
                  </AnimatePresence>
                </div>
              </div>
            </RevealedSetting.Provider>
          )}
        </div>
      </div>
    </div>
    </SurfaceAppearance.Provider>
  );
}

/** Jumps to any setting by name, including ones on another page. */
function SettingsSearch({
  onReveal,
}: {
  onReveal: (section: SettingsSectionId, settingId: string | null) => void;
}) {
  const { language, t: uiT } = useTranslation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => searchSettings(query), [query, language]);
  const open = query.trim().length > 0;

  useEffect(() => setActive(0), [query]);

  const go = (result: SettingsSearchResult | undefined) => {
    if (!result) return;
    onReveal(result.section, result.settingId);
    setQuery("");
    input.current?.blur();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(results.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    }
  };

  return (
    <div ref={root} className="relative shrink-0">
      <SettingsSearchInput
        ref={input}
        role="combobox"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={uiT("Search settings")}
        aria-label={uiT("Search settings")}
        aria-expanded={open}
        aria-controls={listId}
        spellCheck={false}
        autoComplete="off"
        clearLabel={uiT("Clear settings search")}
        onClear={() => {
          setQuery("");
          input.current?.focus();
        }}
        containerClassName="w-56"
        className="h-8 rounded-lg"
      />
      <Popover
        open={open}
        anchor={root}
        side="bottom"
        align="end"
        width={300}
        maxHeight={320}
        onDismiss={(reason) => {
          setQuery("");
          if (reason === "escape") input.current?.focus();
        }}
        id={listId}
        role="listbox"
        aria-label={uiT("Settings search results")}
        className="overflow-y-auto overscroll-contain p-1"
      >
        {results.length === 0 ? (
          <p className="px-2 py-1.5 text-ui-base text-foreground-subtle">
            {uiT("No matching settings")}
          </p>
        ) : (
          results.map((result, index) => (
            <button
              key={`${result.section}:${result.settingId ?? "*"}`}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(result)}
              className={`flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ui-base text-foreground ${
                index === active ? "bg-menu-hover" : ""
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{result.label}</span>
              <span className="shrink-0 text-ui-sm text-foreground-subtlest">
                {result.settingId ? result.sectionLabel : uiT("Page")}
              </span>
            </button>
          ))
        )}
      </Popover>
    </div>
  );
}
