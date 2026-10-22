import { useId } from "react";
import { Bell, BellOff, Bot, ChevronRight, Eye, MessageMultiple, Shield } from "../shared/ui/icons";
import { Switch } from "../shared/ui/forms/Switch";
import { useTranslation } from "../shared/i18n/useTranslation";
import type { useMobileActivity } from "./useMobileActivity";

type NotificationSettings = Pick<ReturnType<typeof useMobileActivity>,
  "enabled" | "permission" | "channelBlocked" | "permissionPending" | "preferences" |
  "preferencesPending" | "setNotificationPreferences" | "setNotificationsEnabled" |
  "requestPermission" | "openSettings" | "canOpenSettings" | "notificationError">;

const categories = [
  { key: "replies", icon: MessageMultiple, title: "Conversation replies", description: "Notify me when an agent finishes a reply." },
  { key: "input", icon: Shield, title: "Permissions and questions", description: "Notify me when a conversation needs approval or an answer." },
  { key: "botReplies", icon: Bot, title: "Bots replies", description: "Notify me when Bots sends a reply, including task results." },
  { key: "botInput", icon: Shield, title: "Bots requests", description: "Notify me when Bots needs approval or an answer." },
] as const;

export function MobileNotificationSettings({ activity }: { activity: NotificationSettings }) {
  const { t } = useTranslation();
  const id = useId();
  const unsupported = activity.permission === "unsupported";
  const blocked = activity.permission === "denied" || activity.permission === "prompt" || activity.channelBlocked;
  const statusTitle = activity.permissionPending ? "Checking notification permission…"
    : unsupported ? "Notifications unavailable"
    : blocked ? "Notifications are disabled on this device"
    : !activity.enabled ? "Notifications are paused"
    : "Notifications are enabled";
  const statusDescription = unsupported ? "System notifications are not supported on this platform. Unread messages remain available in the app."
    : activity.channelBlocked ? "Conversation notifications are blocked in system settings. Enable them to receive alerts."
    : blocked ? "Allow OmniCode to send notifications to receive the alerts selected below."
    : !activity.enabled ? "Turn on system notifications below to receive alerts. Your category choices are saved."
    : "Choose which updates to receive on this device. The conversation you are viewing stays quiet.";
  const StatusIcon = blocked || unsupported || !activity.enabled ? BellOff : Bell;
  return <>
    <section className="mobile-settings-group" aria-label={t("Notification status")}>
      <div className="mobile-settings-card">
        <div className="mobile-settings-row mobile-notification-status" role="status">
          <span className="mobile-settings-icon"><StatusIcon aria-hidden="true" /></span>
          <div className="mobile-settings-label"><span>{t(statusTitle)}</span><small>{t(statusDescription)}</small></div>
        </div>
        {!unsupported && (activity.permission === "prompt" || activity.canOpenSettings) && (
          <button type="button" disabled={activity.permissionPending}
            className="hover:opacity-80 active:opacity-70 mobile-settings-row mobile-settings-action"
            onClick={() => activity.permission === "prompt" ? activity.requestPermission() : activity.openSettings()}>
            <span className="mobile-settings-icon"><Bell aria-hidden="true" /></span>
            <span className="mobile-settings-label">{t(blocked ? "Allow notifications" : "Notification settings…")}</span>
            <ChevronRight aria-hidden="true" />
          </button>
        )}
        {activity.permission === "denied" && !activity.canOpenSettings && (
          <p className="mobile-settings-note mobile-muted">{t("Notifications are blocked in system settings.")}</p>
        )}
      </div>
      {activity.notificationError && <p className="mobile-form-error mobile-settings-footer" role="status">{activity.notificationError}</p>}
    </section>
    <section className="mobile-settings-group" aria-label={t("Notification categories")}>
      <div className="mobile-settings-card">
        <div className="mobile-settings-row mobile-notification-option">
          <span className="mobile-settings-icon"><Bell aria-hidden="true" /></span>
          <label className="mobile-settings-label" htmlFor={`${id}-enabled`}>
            <span>{t("System notifications")}</span>
            <small>{t("Receive alerts from conversations and Bots. Unread badges stay on when alerts are off.")}</small>
          </label>
          <Switch id={`${id}-enabled`} checked={activity.enabled} disabled={unsupported || activity.permissionPending}
            onCheckedChange={checked => void activity.setNotificationsEnabled(checked)} />
        </div>
        {categories.map(({ key, icon: Icon, title, description }) => <div className="mobile-settings-row mobile-notification-option" key={key}>
          <span className="mobile-settings-icon"><Icon aria-hidden="true" /></span>
          <label className="mobile-settings-label" htmlFor={`${id}-${key}`}><span>{t(title)}</span><small id={`${id}-${key}-description`}>{t(description)}</small></label>
          <Switch id={`${id}-${key}`} aria-describedby={`${id}-${key}-description`} checked={activity.preferences[key]}
            disabled={unsupported || !activity.enabled || activity.preferencesPending}
            onCheckedChange={checked => activity.setNotificationPreferences({ ...activity.preferences, [key]: checked })} />
        </div>)}
      </div>
    </section>
    <section className="mobile-settings-group" aria-label={t("Notification privacy")}>
      <div className="mobile-settings-card">
        <div className="mobile-settings-row mobile-notification-option">
          <span className="mobile-settings-icon"><Eye aria-hidden="true" /></span>
          <label className="mobile-settings-label" htmlFor={`${id}-preview`}>
            <span>{t("Show notification previews")}</span>
            <small id={`${id}-preview-description`}>{t("Show reply and request text in notifications. When off, only the title and a general alert are shown.")}</small>
          </label>
          <Switch id={`${id}-preview`} aria-describedby={`${id}-preview-description`} checked={activity.preferences.preview}
            disabled={unsupported || activity.preferencesPending}
            onCheckedChange={checked => activity.setNotificationPreferences({ ...activity.preferences, preview: checked })} />
        </div>
      </div>
    </section>
  </>;
}
