import type { RecentProject } from "./model/recents";

export type ProjectPickerProps = {
  cwd: string;
  recents: RecentProject[];
  /** Project whose rail supplies the choices when it differs from `cwd`. */
  railCwd?: string;
  busy?: boolean;
  mode?: "switch" | "move";
  className?: string;
  buttonClassName?: string;
  appearance?: "ghost" | "filled";
  compact?: boolean;
  /** Keep the project name visible when using compact avatar sizing. */
  showLabel?: boolean;
  onSelectProject: (path: string) => void;
  /** Enables a session-scope picker; an empty cwd selects all projects. */
  onSelectAllProjects?: () => void;
  onOpenProject?: () => void;
  /** Opens the project's context menu; the search input receives focus back. */
  onProjectContextMenu?: (
    path: string,
    x: number,
    y: number,
    trigger: HTMLElement | null,
  ) => void;
  /** Keeps the dropdown open while the project's context menu or its dialogs show. */
  projectMenuActive?: boolean;
};
