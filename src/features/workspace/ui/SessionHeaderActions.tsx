import { createContext, useContext } from "react";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";

/**
 * Window-level actions a chat column's header offers, Claude Desktop style:
 * the overflow menu and the terminal / files toggles. App owns the handlers;
 * headers only read them, so the pane tree needs no extra props.
 */
export type SessionHeaderActions = {
  rename: (sessionId: string, title: string) => void;
  archive: (sessionId: string) => void;
  /** Start a new chat in a column to the right of this one. */
  splitRight: (sessionId: string) => void;
  /** Switch the provider account a conversation uses, in place. */
  selectProviderAccount?: (
    sessionId: string,
    provider: ProviderAccountProvider,
    accountId: string,
  ) => void;
  manageProviderAccounts?: (provider: ProviderAccountProvider) => void;
  terminalAvailable: boolean;
  /** Chats whose own terminals are showing beside them. */
  terminalSessionIds?: ReadonlySet<string>;
  toggleTerminal: (sessionId: string) => void;
  /** Chats whose own file explorer is showing beside them. */
  filesSessionIds?: ReadonlySet<string>;
  toggleFiles?: (sessionId: string) => void;
  changesOpen: boolean;
  toggleChanges: () => void;
};

export const SessionHeaderActionsContext =
  createContext<SessionHeaderActions | null>(null);

export function useSessionHeaderActions(): SessionHeaderActions | null {
  return useContext(SessionHeaderActionsContext);
}
