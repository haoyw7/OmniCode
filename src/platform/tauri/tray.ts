import { invoke } from "@tauri-apps/api/core";

export interface TrayConversation {
  id: string;
  project: string;
  title: string;
  busy: boolean;
  unread: boolean;
  pinned: boolean;
  activityAt: number;
}

export interface TrayMenuLabels {
  open: string;
  unread: string;
  pinned: string;
  recent: string;
  more: string;
  newSession: string;
  quit: string;
}

/** Tray rows are a presentation of Host summaries, never stored sessions. */
export function updateNativeTray(labels: TrayMenuLabels, sessions: TrayConversation[]): Promise<void> {
  return invoke("tray_update", { labels, sessions });
}
