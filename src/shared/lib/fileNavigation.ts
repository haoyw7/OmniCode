export type EditorNavigation = {
  line: number;
  column?: number;
};

export type EditorNavigationTarget = EditorNavigation & {
  path: string;
  token: number;
};

export type FileOpenOptions = {
  /** The caller obtained this concrete path from the filesystem or file index. */
  exact?: boolean;
  /** Open as a permanent tab instead of the pane's preview tab. */
  pin?: boolean;
};

export type OpenFileFn = (
  path: string,
  navigation?: EditorNavigation,
  options?: FileOpenOptions,
) => void;

