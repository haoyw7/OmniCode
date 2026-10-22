import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../../../shared/lib/queryClient";
import { sharedHostMachineId } from "../../../../connections/model/remoteProjects";
import { confirmAction } from "../../../../../platform/tauri/dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { withToast } from "../../../../../shared/ui/primitives/Sonner";
import { loginHarness } from "../../../../../integrations/harness/core/auth";
import { HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import {
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  removeProviderAccount,
  subscribeProviderAccounts,
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
import { clearCachedRateLimits } from "../../../../providers/model/rateLimitsQueries";
import {
  useDeepseekAccount,
  type DeepseekAccountState,
} from "../../../../providers/model/deepseekAccount";

export type AccountEditor = {
  importCurrent?: boolean;
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
  dataHome?: string;
};

/** Providers with locally named profiles that Settings can add and edit. */
export function isAccountProvider(
  harness: HarnessId,
): harness is ProviderAccountProvider {
  return PROVIDER_ACCOUNT_PROVIDERS.some((provider) => provider === harness);
}

/** Providers whose detail shows an Accounts section. */
export function hasProviderAccounts(harness: HarnessId): boolean {
  return (
    isAccountProvider(harness) ||
    harness === "deepseek"
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
  const form = useForm({
    resolver: zodResolver(z.object({
      label: z.string().trim().min(1, uiT("This field is required")).max(48, uiT("Use at most {count} characters", { count: 48 })),
      dataHome: z.string().trim(),
      homeEdited: z.boolean(),
    })),
    defaultValues: { label: "", dataHome: "", homeEdited: false },
  });
  const [editorExpanded, setEditorExpanded] = useState(true);
  const mutation = useMutation({ mutationFn: ({ action }: { key: string; action: () => Promise<void> }) => action() }, queryClient);
  const working = mutation.isPending ? mutation.variables.key : null;
  const [error, setError] = useState<string | null>(null);
  const host = sharedHostMachineId();
  const profilesRead = useQuery({
    queryKey: ["providerAccountProfiles", host], queryFn: async () => { await loadProviderAccounts(); return true; },
  }, queryClient);
  const defaultsRead = useQuery({
    queryKey: ["providerSharedDefaults", host], queryFn: async () => { await requireSharedAccountHost(); await loadSharedProviderDefaults(); return true; },
  }, queryClient);
  const defaultsReady = defaultsRead.isSuccess, profilesReady = profilesRead.isSuccess;
  const defaultsError = defaultsRead.error ? defaultsRead.error instanceof Error ? defaultsRead.error.message : String(defaultsRead.error) : null;

  useEffect(
    () => subscribeProviderAccounts(() => setVersion((value) => value + 1)),
    [],
  );

  const changeSharedDefault = async (
    provider: ProviderAccountProvider,
    accountId: string,
  ) => {
    if (working || !defaultsReady) return;
    const operationKey = `default:${provider}`;
    setError(null);
    try {
      await mutation.mutateAsync({ key: operationKey, action: async () => {
      await withToast(() => setSharedProviderDefault(provider, accountId), {
        loading: uiT("Setting default account…"),
        success: uiT("Default account updated"),
        error: false,
      });
      } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
    form.reset({ label: next.label, dataHome: next.dataHome ?? "", homeEdited: false });
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

  const submitEditor = form.handleSubmit(async (values) => {
    if (!editor || working) return;
    const key = editor.accountId
      ? `rename:${editor.provider}:${editor.accountId}`
      : `add:${editor.provider}`;
    const operationKey = key;
    setError(null);
    const notice = editor.accountId
      ? { loading: uiT("Saving…"), success: uiT("Account saved") }
      : editor.importCurrent
        ? { loading: uiT("Importing account…"), success: uiT("Account imported") }
        : { loading: uiT("Adding account…"), success: uiT("Account added") };
    try {
      await mutation.mutateAsync({ key: operationKey, action: async () => {
      await withToast(async () => {
        if (editor.accountId) {
          await updateProviderAccountProfile({
            id: editor.accountId, provider: editor.provider,
            label: values.label, ...(values.homeEdited ? { dataHome: values.dataHome } : {}),
          });
          clearCachedRateLimits(editor.provider, editor.accountId);
          setVersion((value) => value + 1);
        } else if (editor.importCurrent) {
          await importCurrentCodexAccount(values.label);
        } else {
          await addProviderAccountProfile(editor.provider, values.label, values.dataHome);
        }
      }, notice);
      setEditor(null);
      } });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this account",
      );
    }
  });

  const signIn = async (account: ProviderAccount) => {
    if (working) return;
    const operationKey = `login:${account.provider}:${account.id}`;
    setError(null);
    try {
      await mutation.mutateAsync({ key: operationKey, action: async () => {
      await withToast(() => loginHarness(account.provider, account.id), {
        loading: uiT("Signing in…"),
        success: uiT("Signed in to {account}", { account: account.label }),
        error: false,
      });
      clearCachedRateLimits(account.provider, account.id);
      setVersion((value) => value + 1);
      } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const removeAccount = async (account: ProviderAccount) => {
    if (account.isDefault || working) return;
    const confirmed = await confirmAction(
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
    const operationKey = key;
    setError(null);
    try {
      await mutation.mutateAsync({ key: operationKey, action: async () => {
      await withToast(
        () => removeProviderAccountCredentials(account.provider, account.id),
        { loading: uiT("Removing account…"), success: uiT("Account removed"), error: false },
      );
      removeProviderAccount(account.provider, account.id);
      clearCachedRateLimits(account.provider, account.id);
      if (
        editor?.provider === account.provider &&
        editor.accountId === account.id
      ) {
        setEditor(null);
      }
      } });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not remove this account",
      );
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
    error: error ?? (profilesRead.error ? String(profilesRead.error instanceof Error ? profilesRead.error.message : profilesRead.error) : null),
    defaultsError,
    defaultsReady,
    profilesReady,
    identities,
    usage,
    retry: () => { void profilesRead.refetch(); void defaultsRead.refetch(); },
    cancelEditor: () => setEditor(null),
    form,
    changeSharedDefault,
    startAdd,
    startImport,
    startRename,
    submitEditor,
    signIn,
    removeAccount,
  };
}
