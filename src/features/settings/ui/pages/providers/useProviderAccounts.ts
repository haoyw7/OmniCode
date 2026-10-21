import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { withToast } from "../../../../../shared/ui/primitives/Sonner";
import { loginHarness } from "../../../../../integrations/harness/core/auth";
import { HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import {
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  removeProviderAccount,
  subscribeProviderAccounts,
  type ManagedProviderAccountProvider,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "../../../../providers/model/providerAccounts";
import {
  addProviderAccountProfile,
  importCurrentCodexAccount,
  loadProviderAccounts,
  loadSharedProviderDefaults,
  removeProviderAccountCredentials,
  requireSharedAccountHost,
  setSharedProviderDefault,
  updateProviderAccountProfile,
} from "../../../../providers/model/providerAccountCredentials";
import { useProviderAccountIdentities } from "../../../../providers/model/providerAccountIdentity";
import {
  useProviderAccountUsage,
  type AccountUsage,
} from "../../../../providers/model/accountUsage";
import { clearCachedRateLimits } from "../../../../providers/model/rateLimitsCache";
import {
  useDeepseekAccount,
  type DeepseekAccountState,
} from "../../../../providers/model/deepseekAccount";

export type AccountEditor = {
  homeEdited?: boolean;
  importCurrent?: boolean;
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
  dataHome?: string;
};

/** Providers with locally named profiles that Settings can add and edit. */
export function isAccountProvider(
  harness: HarnessId,
): harness is ManagedProviderAccountProvider {
  return PROVIDER_ACCOUNT_PROVIDERS.some((provider) => provider === harness);
}

/** Providers whose detail shows an Accounts section. */
export function hasProviderAccounts(harness: HarnessId): boolean {
  return (
    isAccountProvider(harness) ||
    harness === "deepseek" ||
    (harness === "workbuddy" && providerAccounts("workbuddy").length > 0)
  );
}

export type ProviderAccountsController = ReturnType<typeof useProviderAccounts>;

/**
 * Account profiles, shared defaults, identities and usage for every provider.
 * Settings loads them once per page so switching providers keeps editors,
 * pending work and usage instead of re-reading Host.
 */
export function useProviderAccounts() {
  const { t: uiT } = useTranslation();
  const [version, setVersion] = useState(0);
  const [deepseekRefresh, setDeepseekRefresh] = useState(0);
  const deepseek: DeepseekAccountState = useDeepseekAccount(deepseekRefresh);
  const [editor, setEditor] = useState<AccountEditor | null>(null);
  const [editorExpanded, setEditorExpanded] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);
  const [defaultsReady, setDefaultsReady] = useState(false);
  const [defaultsRetry, setDefaultsRetry] = useState(0);
  const [profilesReady, setProfilesReady] = useState(false);
  useEffect(() => {
    let current = true;
    void loadProviderAccounts().then(
      () => { if (current) setProfilesReady(true); },
      (reason) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => { current = false; };
  }, [defaultsRetry]);
  useEffect(() => {
    let current = true;
    setDefaultsReady(false);
    void requireSharedAccountHost()
      .then(loadSharedProviderDefaults)
      .then(
        () => {
          if (current) {
            setDefaultsReady(true);
            setDefaultsError(null);
          }
        },
        (reason) => {
          if (current)
            setDefaultsError(
              reason instanceof Error ? reason.message : String(reason),
            );
        },
      );
    return () => {
      current = false;
    };
  }, [defaultsRetry]);

  useEffect(
    () => subscribeProviderAccounts(() => setVersion((value) => value + 1)),
    [],
  );

  const changeSharedDefault = async (
    provider: ProviderAccountProvider,
    accountId: string,
  ) => {
    if (working || !defaultsReady) return;
    setWorking(`default:${provider}`);
    setError(null);
    try {
      await withToast(() => setSharedProviderDefault(provider, accountId), {
        loading: uiT("Setting default account…"),
        success: uiT("Default account updated"),
        error: false,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };

  const toggleEditor = (next: AccountEditor) => {
    setError(null);
    if (
      editor?.provider === next.provider &&
      editor.accountId === next.accountId &&
      Boolean(editor.importCurrent) === Boolean(next.importCurrent)
    ) {
      setEditorExpanded((expanded) => !expanded);
      return;
    }
    setEditor(next);
    setEditorExpanded(true);
  };

  const startAdd = (provider: ProviderAccountProvider) =>
    toggleEditor({ provider, label: "", dataHome: "" });

  const startImport = (provider: ProviderAccountProvider) =>
    toggleEditor({ provider, label: "", importCurrent: true });

  const startRename = (account: ProviderAccount) => {
    toggleEditor({
      provider: account.provider,
      accountId: account.id,
      label: account.label,
      dataHome: account.dataHome ?? "",
    });
  };

  const editLabel = (label: string) =>
    setEditor((current) => (current ? { ...current, label } : current));

  const editDataHome = (dataHome: string) =>
    setEditor((current) =>
      current ? { ...current, dataHome, homeEdited: true } : current,
    );

  const submitEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !editor.label.trim() || working) return;
    const key = editor.accountId
      ? `rename:${editor.provider}:${editor.accountId}`
      : `add:${editor.provider}`;
    setWorking(key);
    setError(null);
    const notice = editor.accountId
      ? { loading: uiT("Saving…"), success: uiT("Account saved") }
      : editor.importCurrent
        ? { loading: uiT("Importing account…"), success: uiT("Account imported") }
        : { loading: uiT("Adding account…"), success: uiT("Account added") };
    try {
      await withToast(async () => {
        if (editor.accountId) {
          await updateProviderAccountProfile({
            id: editor.accountId, provider: editor.provider,
            label: editor.label, ...(editor.homeEdited ? { dataHome: editor.dataHome ?? "" } : {}),
          });
          if (editor.provider !== "workbuddy") clearCachedRateLimits(editor.provider, editor.accountId);
          setVersion((value) => value + 1);
        } else if (editor.importCurrent) {
          await importCurrentCodexAccount(editor.label);
        } else {
          await addProviderAccountProfile(editor.provider, editor.label, editor.dataHome);
        }
      }, { ...notice, error: false });
      setEditor(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this account",
      );
    } finally {
      setWorking(null);
    }
  };

  const signIn = async (account: ProviderAccount) => {
    if (working) return;
    setWorking(`login:${account.provider}:${account.id}`);
    setError(null);
    try {
      await withToast(() => loginHarness(account.provider, account.id), {
        loading: uiT("Signing in…"),
        success: uiT("Signed in to {account}", { account: account.label }),
        error: false,
      });
      if (account.provider !== "workbuddy") clearCachedRateLimits(account.provider, account.id);
      setVersion((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  };

  const removeAccount = async (account: ProviderAccount) => {
    if (account.isDefault || working) return;
    const confirmed = await ask(
      uiT("Remove “{account}”? Running turns will stop. Host-managed credentials will be deleted; custom Data Homes will be kept.", { account: account.label }),
      {
        title: `Remove ${HARNESS_TITLE[account.provider]} account`,
        kind: "warning",
        okLabel: "Remove account",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;
    const key = `remove:${account.provider}:${account.id}`;
    setWorking(key);
    setError(null);
    try {
      await withToast(
        () => removeProviderAccountCredentials(account.provider, account.id),
        { loading: uiT("Removing account…"), success: uiT("Account removed"), error: false },
      );
      removeProviderAccount(account.provider, account.id);
      if (account.provider !== "workbuddy") clearCachedRateLimits(account.provider, account.id);
      if (
        editor?.provider === account.provider &&
        editor.accountId === account.id
      ) {
        setEditor(null);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not remove this account",
      );
    } finally {
      setWorking(null);
    }
  };

  const accounts = PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts);
  const identities = useProviderAccountIdentities(accounts, version, "host");
  const accountUsage = useProviderAccountUsage(version);
  const usage: AccountUsage = {
    ...accountUsage,
    refreshing: accountUsage.refreshing || deepseek.loading,
    refresh: () => {
      setVersion((value) => value + 1);
      setDeepseekRefresh((value) => value + 1);
      accountUsage.refresh();
    },
  };

  return {
    deepseek,
    editor,
    editorExpanded,
    working,
    error,
    defaultsError,
    defaultsReady,
    profilesReady,
    identities,
    usage,
    retry: () => setDefaultsRetry((value) => value + 1),
    cancelEditor: () => setEditor(null),
    editLabel,
    editDataHome,
    changeSharedDefault,
    startAdd,
    startImport,
    startRename,
    submitEditor,
    signIn,
    removeAccount,
  };
}
