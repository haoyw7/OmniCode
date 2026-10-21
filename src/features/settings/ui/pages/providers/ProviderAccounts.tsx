import { Input } from "../../../../../shared/ui/forms/Input";
import { useWatch } from "react-hook-form";
import { FieldError } from "../../../../../shared/ui/primitives/Field";
import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { PresenceBoundary } from "../../../../../shared/ui/PresenceBoundary";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "../../../../../shared/ui/icons";
import { MenuHover } from "../../../../../shared/ui/MenuHover";
import { Button } from "../../../../../shared/ui/forms/Button";
import { useSurfaceVisibility } from "../../../../../shared/ui/SurfaceVisibility";
import { HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import {
  providerAccounts,
  sharedProviderAccountId,
  type ProviderAccountProvider,
} from "../../../../providers/model/providerAccounts";
import {
  identityKey,
  identityOrganizationTag,
} from "../../../../providers/model/providerAccountIdentity";
import { ProviderAccountSubtitle } from "../../../../providers/ui/ProviderAccountSubtitle";
import { accountStatus, accountUsageKey } from "../../../../providers/model/accountUsage";
import {
  AccountStatusLabel,
  AccountUsageRefresh,
  meterWindows,
  UsageMeter,
} from "../../../../providers/ui/ProviderAccountUsage";
import { ExplorerMenu, type ExplorerMenuItem } from "../../../../connections/files/ui/ExplorerMenu";
import type { DeepseekAccountState } from "../../../../providers/model/deepseekAccount";
import { RevealedSetting, settingDomId } from "../../settingsLayout";
import {
  isAccountProvider,
  type AccountEditor,
  type ProviderAccountsController,
} from "./useProviderAccounts";
import { Spinner } from "../../../../../shared/ui/primitives/Spinner";

const ACCOUNTS_SETTING_ID = "provider-accounts";

/** The Accounts section of one provider's detail; search lands here. */
export function ProviderAccounts({
  provider,
  controller,
}: {
  provider: HarnessId;
  controller: ProviderAccountsController;
}) {
  const { t: uiT } = useTranslation();
  const revealed = useContext(RevealedSetting) === ACCOUNTS_SETTING_ID;
  const { usage, error, defaultsError, profilesReady } = controller;
  const accountProvider = isAccountProvider(provider) ? provider : null;
  return (
    <section
      id={settingDomId(ACCOUNTS_SETTING_ID)}
      data-setting-id={ACCOUNTS_SETTING_ID}
      data-revealed={revealed || undefined}
      data-ui="provider-accounts"
      aria-label={uiT("Accounts")}
    >
      <div data-ui="provider-section-header">
        <div className="min-w-0 flex-1">
          <h4 className="text-ui-base font-medium text-foreground">
            {uiT("Accounts")}
          </h4>
          <p className="mt-0.5 text-ui-caption leading-5 text-foreground-subtle">
            {provider === "deepseek"
              ? uiT("Account managed by DeepSeek Harness")
              : uiT(
                  "The badged profile is the default for new conversations on desktop and phone. Accounts apply to every project.",
                )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {accountProvider ? (
            <AccountActions provider={accountProvider} controller={controller} />
          ) : null}
          <AccountUsageRefresh usage={usage} />
        </div>
      </div>
      {accountProvider ? (
        <AccountList provider={accountProvider} controller={controller} />
      ) : provider === "deepseek" ? (
        <DeepseekAccountSettings {...controller.deepseek} />
      ) : null}
      {error ? (
        <p
          className="border-t border-content/5 px-4 py-2.5 text-[11px] leading-4 text-danger"
          role="alert"
        >
          {uiT(error)}
          {!profilesReady && (
            <Button variant="link" size="xs" className="ml-1" onClick={controller.retry}>
              {uiT("Retry")}
            </Button>
          )}
        </p>
      ) : null}
      {defaultsError && accountProvider ? (
        <p
          role="status"
          className="border-t border-content/5 px-4 py-2.5 text-[11px] text-content/50"
        >
          {uiT(defaultsError)}
          <Button variant="link" size="xs" className="ml-1" onClick={controller.retry}>
            {uiT("Retry")}
          </Button>
        </p>
      ) : null}
    </section>
  );
}

function AccountActions({
  provider,
  controller,
}: {
  provider: ProviderAccountProvider;
  controller: ProviderAccountsController;
}) {
  const { t: uiT } = useTranslation();
  const { editor, editorExpanded, working, profilesReady } = controller;
  const adding = editorExpanded && editor?.provider === provider && !editor.accountId;
  return (
    <>
      {provider === "codex" && (
        <Button
          variant="secondary"
          disabled={Boolean(working) || !profilesReady}
          aria-expanded={adding && Boolean(editor?.importCurrent)}
          onClick={() => controller.startImport(provider)}
        >
          {uiT("Import current Codex login")}
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={Boolean(working) || !profilesReady}
        aria-expanded={adding && !editor?.importCurrent}
        onClick={() => controller.startAdd(provider)}
      >
        <Plus className="size-3.5" aria-hidden />
        {uiT("Add account")}
      </Button>
    </>
  );
}

function AccountList({
  provider,
  controller,
}: {
  provider: ProviderAccountProvider;
  controller: ProviderAccountsController;
}) {
  const { t: uiT } = useTranslation();
  const { editor, editorExpanded, working, defaultsReady, identities, usage } = controller;
  const accounts = providerAccounts(provider);
  const adding = editor?.provider === provider && !editor.accountId;
  const sharedDefault = sharedProviderAccountId(provider);
  const editorProps = {
    working: Boolean(working),
    form: controller.form,
    onCancel: controller.cancelEditor,
    onSubmit: controller.submitEditor,
  };
  return (
    <div data-ui="provider-account-list">
      {defaultsReady &&
        sharedDefault !== "default" &&
        !accounts.some((account) => account.id === sharedDefault) && (
          <p role="alert" className="px-4 py-2 text-[11px] text-warning/90">
            {uiT("Unavailable account ({account})", { account: sharedDefault })}
          </p>
        )}
      {accounts.map((account) => {
        const editing =
          editor?.provider === provider && editor.accountId === account.id;
        const removing = working === `remove:${provider}:${account.id}`;
        const signingIn = working === `login:${provider}:${account.id}`;
        const identity = identities[identityKey(account)];
        const orgTag = identityOrganizationTag(identity);
        const limits = usage.usage[accountUsageKey(account)];
        const isSharedDefault = defaultsReady && account.id === sharedDefault;
        // Sign-in only earns a visible button when the profile has no
        // readable login; re-signing a working one lives in the menu.
        const needsSignIn =
          identity === null ||
          (limits?.status === "unavailable" && !limits.error);
        const windows = meterWindows(limits);
        const dataHomeLabel = uiT("Data Home is managed by Host");
        return (
          <div key={account.id} data-ui="provider-account">
            <div className="flex items-start gap-3 p-3">
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
                    onClick={() => void controller.signIn(account)}
                  >
                    {signingIn ? (
                      <Spinner className="size-3.5" aria-hidden />
                    ) : null}
                    {uiT(signingIn ? "Waiting for browser…" : "Sign in")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-md"
                  disabled={Boolean(working)}
                  aria-label={uiT("Rename {value0}", { value0: String(account.label) })}
                  title={uiT("Edit account and Data Home")}
                  aria-expanded={editorExpanded && editing}
                  onClick={() => controller.startRename(account)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <ProviderAccountMenu
                  label={account.label}
                  disabled={Boolean(working)}
                  busy={removing}
                  canSignIn={!needsSignIn && !signingIn}
                  canSetDefault={defaultsReady && !isSharedDefault}
                  canRemove={!account.isDefault}
                  removeLocked={account.id === sharedDefault}
                  onSignIn={() => void controller.signIn(account)}
                  onSetDefault={() =>
                    void controller.changeSharedDefault(provider, account.id)
                  }
                  onRemove={() => void controller.removeAccount(account)}
                />
              </div>
            </div>
            <ProviderAccountEditorDisclosure
              editor={editorExpanded && editing ? editor : null}
              {...editorProps}
            />
          </div>
        );
      })}
      <ProviderAccountEditorDisclosure
        editor={editorExpanded && adding ? editor : null}
        {...editorProps}
      />
    </div>
  );
}

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
      <Button
        ref={button}
        variant="ghost"
        size="icon-md"
        disabled={disabled}
        aria-label={uiT("Actions for {account}", { account: label })}
        data-menu-trigger="settings"
        title={uiT("More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MenuHover />
        {busy ? (
          <Spinner className="size-3.5" />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </Button>
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
  form,
  onCancel,
  onSubmit,
}: {
  editor: AccountEditor;
  working: boolean;
  form: ProviderAccountsController["form"];
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t: uiT } = useTranslation();
  const adding = !editor.accountId;
  const label = useWatch({ control: form.control, name: "label" });
  return (
    <form
      className="border-t border-content/5 px-4 py-2"
      noValidate
      onSubmit={onSubmit}
    >
      <div
        data-provider-account-editor-field
        className="flex items-center pr-1 h-8 min-w-0 flex-1 overflow-hidden rounded-md border border-content/10 bg-content/[0.04] has-[:focus-visible]:focus-fill"
      >
        <label className="h-full min-w-0 flex-1">
          <span className="sr-only">{uiT("Account name")}</span>
          <Input variant="inline"
            autoFocus
            type="text"
            maxLength={48}
            {...form.register("label")}
            aria-invalid={!!form.formState.errors.label}
            disabled={working}
            placeholder={uiT("Work or Personal")}
            aria-label={uiT("{value0} {value1} account", {
              value0: String(adding ? "New" : "Rename"),
              value1: String(HARNESS_TITLE[editor.provider]),
            })}
            className="h-full w-full bg-transparent px-2.5 text-[12px] text-content outline-none focus-visible:focus-fill placeholder:text-content/25 disabled:opacity-50"
          />
        </label>
        <Button variant="secondary" size="sm" disabled={working} onClick={onCancel}>
          {uiT("Cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          className="ml-1"
          disabled={working || form.formState.isSubmitting || !label.trim()}
        >
          {working ? <Spinner className="size-3" /> : null}
          {adding
            ? working
              ? uiT(editor.importCurrent ? "Importing…" : "Saving…")
              : uiT(editor.importCurrent ? "Import account" : "Add account")
            : uiT("Save")}
        </Button>
      </div>
      <FieldError errors={[form.formState.errors.label]} />
      {!editor.importCurrent && <label className="mt-2 block">
        <span className="text-[11px] text-content/60">{uiT("Data Home (optional)")}</span>
        <Input data-ui="input"
          type="text"
          {...form.register("dataHome", { onChange: () => form.setValue("homeEdited", true) })}
          aria-invalid={!!form.formState.errors.dataHome}
          disabled={working}
          aria-label={uiT("{provider} Data Home", { provider: HARNESS_TITLE[editor.provider] })}
          placeholder={editor.accountId === "default"
            ? (editor.provider === "codex" ? "~/.codex" : "~/.claude")
            : (editor.provider === "codex" ? "~/.codex-work" : "~/.claude-work")}
          className="mt-1 h-8 w-full rounded-md border border-content/10 bg-content/[0.04] px-2.5 font-mono text-[12px] text-content outline-none focus-visible:focus-fill disabled:opacity-50"
        />
        <span className="mt-1 block text-[10px] text-content/40">
          {uiT(editor.accountId
            ? "The current Home stays private on Host. Leave this field unchanged to keep it; editing then clearing resets it to the default Home."
            : "Leave empty to use a OmniCode-managed isolated Home.")}
          {" "}{uiT("Use an absolute path or ~/ on Host. New conversations use the updated Home.")}
        </span>
      </label>}
      <FieldError errors={[form.formState.errors.dataHome]} />
    </form>
  );
}

function DeepseekAccountSettings({ account, loading, error }: DeepseekAccountState) {
  const { t } = useTranslation();
  const stored = account?.status === "credential-stored";
  const profile = account?.profile;
  const status = loading ? "Reading account identity…"
    : stored ? profile ? "Signed in" : "Saved sign-in"
      : account?.status === "signed-out" ? "Not signed in" : "Account information unavailable";
  return (
    <div data-ui="provider-account-list" aria-label={HARNESS_TITLE.deepseek} role="group">
      <div data-ui="provider-account" className="p-3" aria-busy={loading}>
        <div className="text-[12px] font-medium text-content/90">{profile?.name || t("DeepSeek account")}</div>
        {profile?.contact ? <ProviderAccountSubtitle
          identity={profile.contact.includes("@") ? { email: profile.contact } : { name: profile.contact }}
          className="mt-1 text-[11px] text-content/75"
        /> : null}
        <div className="mt-1" role="status">
          <AccountStatusLabel status={{ tone: loading ? "checking" : profile ? "ready" : "unknown", label: t(status), detail: null }} wrap className="text-[10px]" />
        </div>
        {error ? <p role="status" className="mt-1 text-[11px] text-content/50">{t(error)}</p> : null}
        {stored && account.profileStatus === "failed" ? <p className="mt-1 text-[11px] text-content/50">{t("Unable to read the DeepSeek profile.")}</p> : null}
        {stored && account.balanceStatus === "failed" ? <p className="mt-1 text-[11px] text-content/50">{t("DeepSeek balance unavailable.")}</p> : null}
        {stored && account.balanceStatus === "ready" ? (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-content/65">
            {account.wallets?.map((wallet, index) => <span key={`wallet:${wallet.currency}:${index}`}>
              {t("Balance: {amount} {currency}", { amount: wallet.balance, currency: wallet.currency })}
            </span>)}
            {account.bonusWallets?.map((wallet, index) => <span key={`bonus:${wallet.currency}:${index}`}>
              {t("Bonus balance: {amount} {currency}", { amount: wallet.balance, currency: wallet.currency })}
            </span>)}
          </div>
        ) : null}
        <p className="mt-1 text-[10px] text-content/40">{t(account?.status === "unsupported"
          ? "DeepSeek account information is unavailable in this DSH configuration."
          : "Sign in or manage this account in DeepSeek Harness on Host, then refresh here.")}</p>
      </div>
    </div>
  );
}
