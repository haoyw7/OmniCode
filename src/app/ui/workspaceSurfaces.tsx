import { useEffect } from "react";
import { listAutomations } from "../../features/automations/model/automations";
import { loadNotes } from "../../features/notes";
import { lazySurface } from "../../shared/ui/lazySurface";
import { preloadNavigationWhenIdle } from "../model/preloadNavigation";

export const SearchView = lazySurface(
  async () => {
    const module = await import("../../features/search/ui/SearchView");
    return { default: module.SearchView };
  },
  { suspense: false },
);

export const SettingsView = lazySurface(
  async () => {
    const module = await import("../../features/settings/ui/SettingsView");
    return { default: module.SettingsView };
  },
  { suspense: false },
);

export const InboxView = lazySurface(
  async () => {
    const module = await import("../../features/inbox/ui/InboxView");
    return { default: module.InboxView };
  },
  { suspense: false },
);

export const LinkedWorkItemPanel = lazySurface(async () => {
  const module = await import("../../features/inbox/ui/LinkedWorkItemPanel");
  return { default: module.LinkedWorkItemPanel };
});

export const NotesView = lazySurface(
  async () => {
    const module = await import("../../features/notes/ui/NotesView");
    return { default: module.NotesView };
  },
  { suspense: false },
);

export const AutomationsView = lazySurface(
  async () => {
    const module =
      await import("../../features/automations/ui/AutomationsView");
    return { default: module.AutomationsView };
  },
  { suspense: false },
);

export function usePreloadWorkspaceSurfaces(notesEnabled: boolean) {
  useEffect(
    () =>
      preloadNavigationWhenIdle([
        InboxView.preload,
        LinkedWorkItemPanel.preload,
        AutomationsView.preload,
        listAutomations,
        ...(notesEnabled ? [NotesView.preload, loadNotes] : []),
      ]),
    [notesEnabled],
  );
}
