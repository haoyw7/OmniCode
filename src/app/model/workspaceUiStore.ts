import { createStore, type StateCreator } from "zustand/vanilla";

type Update<T> = T | ((previous: T) => T);
type SetValue<T> = (update: Update<T>) => void;
type NavigationSlice = {
  navigationExpanded: boolean;
  filesSearchOpen: boolean;
  searchFocusToken: number;
  setNavigationExpanded: SetValue<boolean>;
  setFilesSearchOpen: SetValue<boolean>;
  setSearchFocusToken: SetValue<number>;
};
type PaletteSlice = {
  paletteOpen: boolean;
  paletteQuery: string;
  paletteToken: number;
  setPaletteOpen: SetValue<boolean>;
  setPaletteQuery: SetValue<string>;
  setPaletteToken: SetValue<number>;
};
export type WorkspaceUiState = NavigationSlice & PaletteSlice;

const resolve = <T,>(update: Update<T>, previous: T): T =>
  typeof update === "function" ? (update as (previous: T) => T)(previous) : update;
const updateField = <K extends keyof WorkspaceUiState>(key: K, update: Update<WorkspaceUiState[K]>) =>
  (state: WorkspaceUiState) => {
    const value = resolve(update, state[key]);
    return Object.is(value, state[key]) ? state : { [key]: value } as Pick<WorkspaceUiState, K>;
  };

const navigationSlice: StateCreator<WorkspaceUiState, [], [], NavigationSlice> = set => ({
  navigationExpanded: false,
  filesSearchOpen: false,
  searchFocusToken: 0,
  setNavigationExpanded: update => set(updateField("navigationExpanded", update)),
  setFilesSearchOpen: update => set(updateField("filesSearchOpen", update)),
  setSearchFocusToken: update => set(updateField("searchFocusToken", update)),
});
const paletteSlice: StateCreator<WorkspaceUiState, [], [], PaletteSlice> = set => ({
  paletteOpen: false,
  paletteQuery: "",
  paletteToken: 0,
  setPaletteOpen: update => set(updateField("paletteOpen", update)),
  setPaletteQuery: update => set(updateField("paletteQuery", update)),
  setPaletteToken: update => set(updateField("paletteToken", update)),
});

/** Each workspace window owns its slices; reopening a window cannot inherit another one's overlays. */
export const createWorkspaceUiStore = () => createStore<WorkspaceUiState>()((...args) => ({
  ...navigationSlice(...args),
  ...paletteSlice(...args),
}));
