export type MobileSettingsPage =
  "root" | "agents" | "notifications" | "chat" |
  "connections" | "updates" | "glass" | "skin" | "archive" | "accounts";
export type MobilePreferencePanel =
  "theme" | "accent" | "language" | "glass" | "follow-up" | "transcript-layout" |
  "agent-defaults" | "default-permissions" | "account-claude" | "account-codex" |
  "connection-menu" | "connection-edit" | "connection-delete" | null;

const SETTINGS_TITLES: Record<MobileSettingsPage, string> = {
  root: "Settings",
  agents: "New conversations",
  accounts: "Accounts and usage",
  notifications: "Notifications",
  chat: "Message composer",
  connections: "Connections",
  updates: "App updates",
  glass: "Glass",
  skin: "Skin",
  archive: "Archived conversations",
};

export function mobileSettingsTitle(page: MobileSettingsPage) {
  return SETTINGS_TITLES[page];
}

export function mobileSettingsParent(_page: MobileSettingsPage): MobileSettingsPage {
  return "root";
}
