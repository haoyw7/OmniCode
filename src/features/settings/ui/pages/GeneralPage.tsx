import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../../shared/lib/queryClient";
import { usePreferenceState } from "../../model/usePreferenceState";
import { formatBuildVersion } from "../../../../shared/lib/buildVersion";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { setUiLanguage, type UiLanguage } from "../../../../shared/i18n/language";
import { ArrowDownCircle, RefreshCw } from "../../../../shared/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "../../../../shared/ui/forms/Button";
import { IS_LINUX, IS_MAC, IS_WIN } from "../../../../platform/tauri/platform";
import {
  loadCloseToTray,
  loadFileTabMode,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  loadQuickComposerEnabled,
  loadQuickComposerShortcut,
  loadTabAnimationsEnabled,
  saveCloseToTray,
  saveFileTabMode,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
  saveQuickComposerEnabled,
  saveTabAnimationsEnabled,
  type FileTabMode,
} from "../../model/settings";
import { loadSoundsEnabled, saveSoundsEnabled } from "../../model/sounds";
import { setQuickComposerShortcut } from "../../../quick-composer/model/quickComposer";
import { quickComposerShortcutLabel } from "../../../quick-composer/model/quickComposerShortcut";
import {
  cachedNotificationPermission,
  loadNotificationsEnabled,
  openNotificationSettings,
  probeNotificationPermission,
  requestNotificationPermission,
  saveNotificationsEnabled,
  type NotificationPermission,
} from "../../../notifications/model/notifications";
import {
  installPendingUpdate,
  readAppVersion,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../../../../app/model/updater";
import { Group, Row, Segmented, Toggle } from "../settingsLayout";
import { Spinner } from "../../../../shared/ui/primitives/Spinner";



export function GeneralPage({
  onOpenWhatsNew,
}: {
  onOpenWhatsNew: (version: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const [soundsEnabled, setSoundsEnabled] = usePreferenceState(loadSoundsEnabled);
  const [notificationsEnabled, setNotificationsEnabled] = usePreferenceState(
    loadNotificationsEnabled,
  );
  const permissionQuery = { queryKey: ["notificationPermission"], queryFn: probeNotificationPermission };
  const permissionRead = useQuery({ ...permissionQuery, enabled: notificationsEnabled }, queryClient);
  const permissionMutation = useMutation({ mutationFn: requestNotificationPermission,
    onSuccess: value => queryClient.setQueryData(permissionQuery.queryKey, value),
  }, queryClient);
  const notificationPermission: NotificationPermission = permissionRead.data ?? cachedNotificationPermission();
  const [notesEnabled, setNotesEnabled] = usePreferenceState(loadNotesEnabled);
  const [liveAgentsEnabled, setLiveAgentsEnabled] = usePreferenceState(
    loadLiveAgentsEnabled,
  );
  const [fileTabMode, setFileTabMode] = usePreferenceState<FileTabMode>(loadFileTabMode);
  const [tabAnimationsEnabled, setTabAnimationsEnabled] = usePreferenceState(
    loadTabAnimationsEnabled,
  );
  const [closeToTray, setCloseToTray] = usePreferenceState(loadCloseToTray);
  const [quickComposerEnabled, setQuickComposerEnabled] = usePreferenceState(
    loadQuickComposerEnabled,
  );
  const [quickComposerError, setQuickComposerError] = useState<string | null>(
    null,
  );

  const onSoundsEnabled = (next: boolean) => {
    saveSoundsEnabled(next);
    setSoundsEnabled(next);
  };

  const onNotificationsEnabled = (next: boolean) => {
    saveNotificationsEnabled(next);
    setNotificationsEnabled(next);
    if (!next) return;
    permissionMutation.mutate();
  };

  const onNotesEnabled = (next: boolean) => {
    saveNotesEnabled(next);
    setNotesEnabled(next);
  };

  const onQuickComposerEnabled = (next: boolean) => {
    saveQuickComposerEnabled(next);
    setQuickComposerEnabled(next);
    setQuickComposerError(null);
    void setQuickComposerShortcut(next).catch((error: unknown) => {
      // Another app already owns the combination. Leave the switch where the
      // user put it so the next launch tries again, but say why it is dead.
      setQuickComposerError(String(error));
    });
  };

  const onLiveAgentsEnabled = (next: boolean) => {
    saveLiveAgentsEnabled(next);
    setLiveAgentsEnabled(next);
  };

  const onFileTabMode = (next: FileTabMode) => {
    saveFileTabMode(next);
    setFileTabMode(next);
  };

  const onTabAnimationsEnabled = (next: boolean) => {
    saveTabAnimationsEnabled(next);
    setTabAnimationsEnabled(next);
  };

  const onCloseToTray = (next: boolean) => {
    saveCloseToTray(next);
    setCloseToTray(next);
  };

  return (
    <>
      <LanguageSetting />
      <Group
        title={uiT("Alerts")}
        description={uiT(
          "How OmniCode reaches you while you are looking somewhere else.",
        )}
      >
        <Row
          id="sounds"
          label={uiT("Sounds")}
          description={uiT(
            "Short cues for project activity, finished turns, and available updates. Choose project notification categories in Inbox settings. Switches and Copy on a finished turn also play.",
          )}
        >
          <Toggle
            label={uiT("Sounds")}
            on={soundsEnabled}
            onChange={onSoundsEnabled}
          />
        </Row>
        <Row
          id="notifications"
          label={uiT("Notifications")}
          description={uiT(
            "Notify when a reminder is due, or when an agent finishes or needs input in another session or while OmniCode is in the background. Click the notification to open that session.",
          )}
        >
          {notificationsEnabled && notificationPermission === "denied" ? (
            <NotificationsBlocked />
          ) : null}
          {notificationsEnabled && notificationPermission === "unsupported" ? (
            <span className="text-[12px] text-content/45">
              {uiT("Not available on this platform")}
            </span>
          ) : null}
          <Toggle
            label={uiT("Notifications")}
            on={notificationsEnabled}
            onChange={onNotificationsEnabled}
          />
        </Row>
      </Group>

      <Group
        title={uiT("Workspace")}
        description={uiT("How project navigation and workspace tabs behave.")}
      >
        <Row
          id="file-tabs"
          label={uiT("File tabs")}
          description={uiT(
            "Each conversation keeps its own file and page tabs. Choose the default layout; the conversation toolbar can switch it at any time.",
          )}
        >
          <Segmented
            label={uiT("File tabs")}
            value={fileTabMode}
            options={[
              { value: "pane", label: uiT("Split view") },
              { value: "workspace", label: uiT("Full view") },
            ]}
            onChange={onFileTabMode}
          />
        </Row>
        <Row
          id="tab-animations"
          label={uiT("Tab animations")}
          description={uiT(
            "Animate tabs as they open and close. Turn this off for instant tab changes.",
          )}
        >
          <Toggle
            label={uiT("Tab animations")}
            on={tabAnimationsEnabled}
            onChange={onTabAnimationsEnabled}
          />
        </Row>
        <Row
          id="notes"
          label={uiT("Notes")}
          description={uiT(
            "A global markdown notebook in the activity bar. Save a finished turn from the transcript, then mention it later with @note or add it to chat.",
          )}
        >
          <Toggle
            label={uiT("Notes")}
            on={notesEnabled}
            onChange={onNotesEnabled}
          />
        </Row>
        {IS_MAC && (
          <Row
            id="quick-composer"
            label={uiT("Quick composer")}
            description={uiT(
              "Press {value0} in any app to float a prompt over it and start a session without switching to OmniCode. Change the shortcut in Keybindings. Return starts it in the background; ⌘Return starts it and brings the session forward.",
              {
                value0: String(
                  quickComposerShortcutLabel(loadQuickComposerShortcut()),
                ),
              },
            )}
          >
            {quickComposerError ? (
              <span className="text-[12px] text-content/45">
                {quickComposerError}
              </span>
            ) : null}
            <Toggle
              label={uiT("Quick composer")}
              on={quickComposerEnabled}
              onChange={onQuickComposerEnabled}
            />
          </Row>
        )}
        <Row
          id="working-agents"
          label={uiT("Working agents")}
          description={uiT(
            "Open the working agents icon in the activity bar to jump across projects. Finished turns stay until you open that session.",
          )}
        >
          <Toggle
            label={uiT("Working agents")}
            on={liveAgentsEnabled}
            onChange={onLiveAgentsEnabled}
          />
        </Row>
        {(IS_WIN || IS_LINUX) && (
          <Row
            id="close-to-tray"
            label={uiT("Close to tray")}
            description={uiT(
              "Closing a window hides it to the system tray instead of quitting, so running agents keep going. Reopen from the tray icon, and quit for real from its menu. Turn this off to have close end the window.",
            )}
          >
            <Toggle
              label={uiT("Close to tray")}
              on={closeToTray}
              onChange={onCloseToTray}
            />
          </Row>
        )}
      </Group>

      <Group title={uiT("About")}>
        <UpdateRow onOpenWhatsNew={onOpenWhatsNew} />
      </Group>
    </>
  );
}

function LanguageSetting() {
  const { language, t } = useTranslation();
  return (
    <Group
      title={t("Language")}
      description={t(
        "Choose the language used by OmniCode. Changes apply immediately to all windows.",
      )}
    >
      <Row
        id="ui-language"
        label={t("Interface language")}
        description={t(
          "Your choice is remembered. Agent messages, code, and project names keep their original content.",
        )}
      >
        <Segmented<UiLanguage>
          label={t("Interface language")}
          value={language}
          options={[
            { value: "en", label: "English" },
            { value: "zh-CN", label: "简体中文" },
          ]}
          onChange={setUiLanguage}
        />
      </Row>
    </Group>
  );
}

function UpdateRow({
  onOpenWhatsNew,
}: {
  onOpenWhatsNew: (version: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  const version = useQuery({ queryKey: ["app", "version"], queryFn: readAppVersion, staleTime: Infinity }, queryClient);
  useEffect(() => { if (version.data) setSnapshot(current => ({ ...current, currentVersion: version.data })); }, [version.data]);
  const update = useMutation({ mutationFn: () => snapshot.phase === "available" ? installPendingUpdate(setSnapshot) : runUpdateFlow(true, setSnapshot) }, queryClient);

  const busy =
    snapshot.phase === "checking" || snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available";

  const onClick = () => { if (!busy && !update.isPending) update.mutate(); };

  const status =
    snapshot.phase === "available"
      ? `Version ${formatBuildVersion(snapshot.availableVersion ?? "")} is available.`
      : snapshot.phase === "downloading"
        ? `Downloading${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
        : snapshot.phase === "checking"
          ? "Checking for updates…"
          : snapshot.phase === "current"
            ? "You're on the latest version."
            : snapshot.phase === "error"
              ? (snapshot.error ?? "Update check failed.")
              : "OmniCode updates itself from the release feed.";

  return (
    <Row
      id="update"
      label={
        <span className="flex items-baseline gap-2">
          {uiT("Version")}
          <span className="font-mono text-[12px] text-content/45">
            {formatBuildVersion(snapshot.currentVersion)}
          </span>
        </span>
      }
      description={status}
    >
      <div className="flex items-center gap-2">
        <Button variant="secondary"
          onClick={() => onOpenWhatsNew(snapshot.currentVersion)}
          disabled={snapshot.currentVersion === "…"}
        >
          {uiT("What's new")}
        </Button>
        <Button variant="secondary" onClick={() => void onClick()} disabled={busy}>
          {busy ? (
            <Spinner className="size-3.5" aria-hidden />
          ) : hasUpdate ? (
            <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          {hasUpdate ? uiT("Download") : uiT("Check for updates")}
        </Button>
      </div>
    </Row>
  );
}

/** macOS keeps the decision after the first prompt; only System Settings can flip it. Windows toasts are governed by Settings > Notifications. */
function NotificationsBlocked() {
  const { t: uiT } = useTranslation();
  return (
    <span className="flex items-center gap-2 text-[12px] text-content/45">
      {uiT("Permission needed")}
      {IS_MAC || IS_WIN ? (
        <Button variant="ghost" size="content"
          type="button"
          onClick={() => {
            void openNotificationSettings().catch(() => {});
          }}
          className="rounded-md border border-content/10 px-2 py-1 text-content/70 hover:bg-content/6 hover:text-content"
        >
          {uiT("Open System Settings")}
        </Button>
      ) : null}
    </span>
  );
}
