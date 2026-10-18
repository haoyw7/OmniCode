import { PresenceBoundary } from "../../../../../shared/ui/PresenceBoundary";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { ask } from "@tauri-apps/plugin-dialog";
import { Loader, MoreHorizontal, Pencil, Plus, Trash2 } from "../../../../../shared/ui/icons";
import { withStatusToast } from "../../../../../shared/ui/StatusToast";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { HarnessIcon } from "../../../../sessions/ui/HarnessIcon";
import { MenuHover } from "../../../../../shared/ui/MenuHover";
import { Button } from "../../../../../shared/ui/forms/Button";
import { loginHarness } from "../../../../../integrations/harness/core/auth";
import { HARNESS_TITLE } from "../../../../sessions/model/session";
import {
  providerAccounts,
  sharedProviderAccountId,
  PROVIDER_ACCOUNT_PROVIDERS,
  removeProviderAccount,
  subscribeProviderAccounts,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "../../../../providers/model/providerAccounts";
import {
  removeProviderAccountCredentials,
  loadSharedProviderDefaults,
  setSharedProviderDefault,
  importCurrentCodexAccount,
  requireSharedAccountHost,
  loadProviderAccounts,
  addProviderAccountProfile,
  updateProviderAccountProfile,
} from "../../../../providers/model/providerAccountCredentials";
import {
  identityKey,
  identityOrganizationTag,
  useProviderAccountIdentities,
} from "../../../../providers/model/providerAccountIdentity";
import { ProviderAccountSubtitle } from "../../../../providers/ui/ProviderAccountSubtitle";
import {
  accountStatus,
  accountUsageKey,
  useProviderAccountUsage,
} from "../../../../providers/model/accountUsage";
import { clearCachedRateLimits } from "../../../../providers/model/rateLimitsCache";
import {
  AccountStatusLabel,
  AccountUsageRefresh,
  meterWindows,
  UsageMeter,
} from "../../../../providers/ui/ProviderAccountUsage";
import { ExplorerMenu, type ExplorerMenuItem } from "../../../../connections/files/ui/ExplorerMenu";
import { useSurfaceVisibility } from "../../../../../shared/ui/SurfaceVisibility";
import { Group } from "../../settingsLayout";



type AccountEditor = {
  homeEdited?: boolean;
  importCurrent?: boolean;
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
  dataHome?: string;
};

/** The ⋯ menu for one account row: the actions a row needs only sometimes. */
function ProviderAccountMenu({
  label,
  disabled,
  busy,
  canSignIn,
  canSetDefault,
  canRemove,
  removeLocked,
  onSignIn,
  onSetDefault,
  onRemove,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  canSignIn: boolean;
  canSetDefault: boolean;
  canRemove: boolean;
  /** The shared default cannot be removed until another account replaces it. */
  removeLocked: boolean;
  onSignIn: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!visible || disabled) setOpen(false);
  }, [visible, disabled]);

  const items: ExplorerMenuItem[] = [];
  if (canSignIn) {
    items.push({ kind: "item", id: "sign-in", label: uiT("Sign in again") });
  }
  if (canSetDefault) {
    items.push({
      kind: "item",
      id: "default",
      label: uiT("Use as shared default"),
    });
  }
  if (canRemove) {
    if (items.length > 0) items.push({ kind: "sep" });
    items.push({
      kind: "item",
      id: "remove",
      label: uiT("Remove account"),
      icon: <Trash2 className="size-4" />,
      danger: true,
      disabled: removeLocked,
      description: removeLocked
        ? uiT("Choose another shared default first")
        : undefined,
    });
  }
  if (items.length === 0) return null;

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label={uiT("Actions for {account}", { account: label })}
        data-menu-trigger="settings"
        title={uiT("More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="grid size-7 place-items-center rounded-md text-content/40 transition-transform duration-150 hover:bg-content/6 hover:text-content active:scale-[0.96] disabled:opacity-35"
      >
        <MenuHover />
        {busy ? (
          <Loader className="size-3.5 animate-spin" />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </button>
      <PresenceBoundary propagate>{visible && open && button.current ? (
        <ExplorerMenu
          anchor={button.current}
          side="bottom"
          align="end"
          width={220}
          ariaLabel={uiT("Actions for {account}", { account: label })}
          items={items}
          onPick={(id) => {
            close();
            if (id === "sign-in") onSignIn();
            else if (id === "default") onSetDefault();
            else if (id === "remove") onRemove();
          }}
          onClose={close}
        />
      ) : null}</PresenceBoundary>
    </>
  );
}

export function ProviderAccountsSettings() {
  const { t: uiT } = useTranslation();
  const [version, setVersion] = useState(0);
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

  const changeSharedDefault = async (
    provider: ProviderAccountProvider,
    accountId: string,
  ) => {
    if (working || !defaultsReady) return;
    setWorking(`default:${provider}`);
    setError(null);
    try {
      await withStatusToast(() => setSharedProviderDefault(provider, accountId), {
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

  useEffect(
    () => subscribeProviderAccounts(() => setVersion((value) => value + 1)),
    [],
  );

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

  const startRename = (account: ProviderAccount) => {
    toggleEditor({
      provider: account.provider,
      accountId: account.id,
      label: account.label,
      dataHome: account.dataHome ?? "",
    });
  };

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
      await withStatusToast(async () => {
        if (editor.accountId) {
          await updateProviderAccountProfile({
            id: editor.accountId, provider: editor.provider,
            label: editor.label, ...(editor.homeEdited ? { dataHome: editor.dataHome ?? "" } : {}),
          });
          clearCachedRateLimits(editor.provider, editor.accountId);
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
      await withStatusToast(() => loginHarness(account.provider, account.id), {
        loading: uiT("Signing in…"),
        success: uiT("Signed in to {account}", { account: account.label }),
        error: false,
      });
      clearCachedRateLimits(account.provider, account.id);
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
      await withStatusToast(
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
  const usage = useProviderAccountUsage(version);

  return (
    <Group
      id="provider-accounts"
      title={uiT("Accounts")}
      description={uiT(
        "Each row is a saved CLI profile. Edit its Home or sign in directly, including the built-in profile. The badged row is the default for new conversations on desktop and phone.",
      )}
      action={<AccountUsageRefresh usage={{ ...usage, refresh: () => {
        setVersion((value) => value + 1);
        usage.refresh();
      } }} />}
    >
      {PROVIDER_ACCOUNT_PROVIDERS.map((provider) => {
        const accounts = providerAccounts(provider);
        const adding = editor?.provider === provider && !editor.accountId;
        const sharedDefault = sharedProviderAccountId(provider);
        return (
          <div
            key={provider}
            className="border-b border-content/5 last:border-b-0"
          >
            <div className="flex items-center gap-4 px-4 py-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
                  <HarnessIcon harness={provider} className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-content">
                    {HARNESS_TITLE[provider]}
                  </div>
                  <div className="mt-0.5 text-[11px] text-content/40">
                    {accounts.length}{" "}
                    {accounts.length === 1 ? uiT("account") : uiT("accounts")}
                  </div>
                </div>
              </div>
              {provider === "codex" && (
                <button
                  type="button"
                  disabled={Boolean(working) || !profilesReady}
                  aria-expanded={editorExpanded && adding && Boolean(editor.importCurrent)}
                  onClick={() => toggleEditor({ provider, label: "", importCurrent: true })}
                  className="shrink-0 rounded-md border border-content/10 px-2.5 py-1 text-[12px] text-content/70 transition-transform duration-150 hover:bg-content/6 hover:text-content active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
                >
                  {uiT("Import current Codex login")}
                </button>
              )}
              <button
                type="button"
                disabled={Boolean(working) || !profilesReady}
                aria-expanded={editorExpanded && adding && !editor.importCurrent}
                onClick={() => startAdd(provider)}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1 text-[12px] text-content/70 transition-transform duration-150 hover:bg-content/6 hover:text-content active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
              >
                <Plus className="size-3.5" aria-hidden />
                {uiT("Add account")}
              </button>
            </div>
            {defaultsReady &&
              sharedDefault !== "default" &&
              !accounts.some((account) => account.id === sharedDefault) && (
                <p role="alert" className="px-4 pb-3 pl-[3.375rem] text-[11px] text-amber-400/90">
                  {uiT("Unavailable account ({account})", {
                    account: sharedDefault,
                  })}
                </p>
              )}
            <div className="bg-content/[0.015] pl-[2.375rem]">
              {accounts.map((account) => {
                const editing =
                  editor?.provider === provider &&
                  editor.accountId === account.id;
                const removing = working === `remove:${provider}:${account.id}`;
                const signingIn = working === `login:${provider}:${account.id}`;
                const identity = identities[identityKey(account)];
                const orgTag = identityOrganizationTag(identity);
                const limits = usage.usage[accountUsageKey(account)];
                const isSharedDefault =
                  defaultsReady && account.id === sharedDefault;
                // Sign-in only earns a visible button when the profile has no
                // readable login; re-signing a working one lives in the menu.
                const needsSignIn =
                  identity === null ||
                  (limits?.status === "unavailable" && !limits.error);
                const windows = meterWindows(limits);
                const dataHomeLabel = uiT("Data Home is managed by Host");
                return (
                  <Fragment key={account.id}>
                  <div className="flex items-start gap-3 border-t border-content/5 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span className="min-w-0 truncate text-[12px] font-medium text-content/90">
                          {account.isDefault && account.label === "Default account"
                            ? uiT("Built-in CLI profile") : account.label}
                        </span>
                        {account.isDefault && account.label !== "Default account" && (
                          <span className="shrink-0 text-[10px] text-content/45">{uiT("Built-in CLI profile")}</span>
                        )}
                        {orgTag ? (
                          <span className="max-w-[8rem] shrink-0 truncate rounded bg-content/[0.07] px-1 text-[10px] leading-4 text-content/50">
                            {orgTag}
                          </span>
                        ) : null}
                        {isSharedDefault ? (
                          <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[10px] font-medium leading-4 text-accent">
                            {uiT("Default for new conversations")}
                          </span>
                        ) : null}
                      </div>
                      <div
                        data-provider-account-identity={identityKey(account)}
                        title={uiT("Actual account")}
                        className="mt-1 min-w-0 text-[11px]"
                      >
                        <ProviderAccountSubtitle
                          identity={identity}
                          fallback={uiT(identity === undefined
                            ? "Reading account identity…"
                            : "No account identity could be read from this Home. Check the path or sign in.")}
                          className="block break-words text-content/75"
                        />
                      </div>
                      <AccountStatusLabel
                        status={accountStatus(limits, usage.now)}
                        wrap
                        className="mt-1 max-w-full text-[10px]"
                      />
                      <div title={dataHomeLabel} className="mt-0.5 truncate font-mono text-[10px] text-content/40" data-provider-account-home>
                        {dataHomeLabel}
                      </div>
                      {windows.length > 0 ? (
                        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
                          {windows.map((entry) => (
                            <UsageMeter
                              key={entry.title}
                              title={entry.title}
                              window={entry.window}
                              now={usage.now}
                              className="w-40"
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {needsSignIn || signingIn ? (
                        <Button variant="secondary"
                          disabled={Boolean(working)}
                          aria-label={uiT("Sign in to {account}", { account: account.label })}
                          onClick={() => void signIn(account)}
                        >
                          {signingIn ? (
                            <Loader className="size-3.5 animate-spin" aria-hidden />
                          ) : null}
                          {uiT(signingIn ? "Waiting for browser…" : "Sign in")}
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        disabled={Boolean(working)}
                        aria-label={uiT("Rename {value0}", {
                          value0: String(account.label),
                        })}
                        title={uiT("Edit account and Data Home")}
                        aria-expanded={editorExpanded && editing}
                        onClick={() => startRename(account)}
                        className="grid size-7 place-items-center rounded-md text-content/40 transition-transform duration-150 hover:bg-content/6 hover:text-content active:scale-[0.96] disabled:opacity-35"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <ProviderAccountMenu
                        label={account.label}
                        disabled={Boolean(working)}
                        busy={removing}
                        canSignIn={!needsSignIn && !signingIn}
                        canSetDefault={defaultsReady && !isSharedDefault}
                        canRemove={!account.isDefault}
                        removeLocked={account.id === sharedDefault}
                        onSignIn={() => void signIn(account)}
                        onSetDefault={() =>
                          void changeSharedDefault(provider, account.id)
                        }
                        onRemove={() => void removeAccount(account)}
                      />
                    </div>
                  </div>
                  <ProviderAccountEditorDisclosure
                    editor={editorExpanded && editing ? editor : null}
                    working={Boolean(working)}
                    onLabel={label => setEditor(current => current ? { ...current, label } : current)}
                    onDataHome={dataHome => setEditor(current => current ? { ...current, dataHome, homeEdited: true } : current)}
                    onCancel={() => setEditor(null)}
                    onSubmit={submitEditor}
                  />
                  </Fragment>
                );
              })}
              <ProviderAccountEditorDisclosure
                editor={editorExpanded && adding ? editor : null}
                working={Boolean(working)}
                onLabel={(label) =>
                  setEditor((current) =>
                    current ? { ...current, label } : current,
                  )
                }
                onDataHome={dataHome => setEditor(current => current ? { ...current, dataHome, homeEdited: true } : current)}
                onCancel={() => setEditor(null)}
                onSubmit={submitEditor}
              />
            </div>
          </div>
        );
      })}
      {error ? (
        <p
          className="border-t border-content/5 px-4 py-2.5 text-[11px] leading-4 text-red-400"
          role="alert"
        >
          {uiT(error)}
          {!profilesReady && <button type="button" className="ml-2 underline" onClick={() => setDefaultsRetry(value => value + 1)}>{uiT("Retry")}</button>}
        </p>
      ) : null}
      {defaultsError && (
        <p
          role="status"
          className="border-t border-content/5 px-4 py-2.5 text-[11px] text-content/50"
        >
          {uiT(defaultsError)}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setDefaultsRetry((value) => value + 1)}
          >
            {uiT("Retry")}
          </button>
        </p>
      )}
    </Group>
  );
}

function ProviderAccountEditorDisclosure({
  editor,
  ...props
}: Omit<Parameters<typeof ProviderAccountEditor>[0], "editor"> & {
  editor: AccountEditor | null;
}) {
  const retained = useRef(editor);
  if (editor) retained.current = editor;
  return (
    <AnimatedCollapse expanded={!!editor}>
      {retained.current && (
        <ProviderAccountEditor {...props} editor={retained.current} />
      )}
    </AnimatedCollapse>
  );
}

function ProviderAccountEditor({
  editor,
  working,
  onLabel,
  onDataHome,
  onCancel,
  onSubmit,
}: {
  editor: AccountEditor;
  working: boolean;
  onLabel: (label: string) => void;
  onDataHome?: (home: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t: uiT } = useTranslation();
  const adding = !editor.accountId;
  return (
    <form
      className="border-t border-content/5 px-4 py-2"
      onSubmit={onSubmit}
    >
      <div
        data-provider-account-editor-field
        className="flex items-center pr-1 h-8 min-w-0 flex-1 overflow-hidden rounded-md border border-content/10 bg-content/[0.04] focus-within:border-accent/45"
      >
        <label className="h-full min-w-0 flex-1">
          <span className="sr-only">{uiT("Account name")}</span>
          <input
            autoFocus
            type="text"
            maxLength={48}
            value={editor.label}
            disabled={working}
            placeholder={uiT("Work or Personal")}
            aria-label={uiT("{value0} {value1} account", {
              value0: String(adding ? "New" : "Rename"),
              value1: String(HARNESS_TITLE[editor.provider]),
            })}
            onChange={(event) => onLabel(event.target.value)}
            className="h-full w-full bg-transparent px-2.5 text-[12px] text-content outline-none placeholder:text-content/25 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={working}
          onClick={onCancel}
          className="flex h-6 shrink-0 items-center rounded-[4.5px] bg-content/[0.05] px-2.5 text-[11px] text-content/45 transition-transform duration-150 hover:bg-content/6 hover:text-content active:scale-[0.97] disabled:opacity-40"
        >
          {uiT("Cancel")}
        </button>
        <button
          type="submit"
          disabled={working || !editor.label.trim()}
          className="ml-1 flex h-6 shrink-0 items-center gap-1.5 rounded-[4.5px] bg-content px-2.5 text-[11px] font-medium text-background-base transition-transform duration-150 hover:bg-content/85 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
        >
          {working ? <Loader className="size-3 animate-spin" /> : null}
          {adding
            ? working
              ? uiT(editor.importCurrent ? "Importing…" : "Saving…")
              : uiT(editor.importCurrent ? "Import account" : "Add account")
            : uiT("Save")}
        </button>
      </div>
      {!editor.importCurrent && <label className="mt-2 block">
        <span className="text-[11px] text-content/60">{uiT("Data Home (optional)")}</span>
        <input data-ui="input"
          type="text"
          value={editor.dataHome ?? ""}
          disabled={working}
          aria-label={uiT("{provider} Data Home", { provider: HARNESS_TITLE[editor.provider] })}
          placeholder={editor.accountId === "default"
            ? (editor.provider === "codex" ? "~/.codex" : "~/.claude")
            : (editor.provider === "codex" ? "~/.codex-work" : "~/.claude-work")}
          onChange={event => onDataHome?.(event.target.value)}
          className="mt-1 h-8 w-full rounded-md border border-content/10 bg-content/[0.04] px-2.5 font-mono text-[12px] text-content outline-none focus:border-accent/45 disabled:opacity-50"
        />
        <span className="mt-1 block text-[10px] text-content/40">
          {uiT(editor.accountId
            ? "The current Home stays private on Host. Leave this field unchanged to keep it; editing then clearing resets it to the default Home."
            : "Leave empty to use a OmniCode-managed isolated Home.")}
          {" "}{uiT("Use an absolute path or ~/ on Host. New conversations use the updated Home.")}
        </span>
      </label>}
    </form>
  );
}
