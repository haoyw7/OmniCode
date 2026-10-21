import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { cn } from "../../../shared/lib/cn";
import { Input } from "../../../shared/ui/forms/Input";
import { Textarea } from "../../../shared/ui/forms/Textarea";
import { useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { queryClient } from "../../../shared/lib/queryClient";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { revealPath } from "../../../platform/tauri/fs";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import type { RecentProject } from "../../projects/model/recents";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import { Popover } from "../../../shared/ui/Popover";
import { LAYER } from "../../../shared/lib/layers";
import {
  Globe,
  Plus,
  RefreshCw,
  ListFilter,
  Check,
} from "../../../shared/ui/icons";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { mcpServerKey } from "../model/mcpInspect";
import { McpServerDetails } from "./McpServerDetails";
import { MCP_PROVIDER_LABELS, type McpConnection } from "../model/mcp";
import {
  useMcpSettings,
  loadMcpSettings,
  type McpServerRow,
} from "../model/mcpSettingsQueries";

type Scope = McpConnection["scope"];
type ServerRow = McpServerRow;
type Filter = "all" | McpConnection["provider"];
type Provider = McpConnection["provider"];
const PROVIDERS: Provider[] = [
  "claude",
  "claude_desktop",
  "codex",
  "cursor",
  "opencode",
  "pi",
];
const SCOPES: Record<Provider, Scope[]> = {
  claude: ["local", "project", "user"],
  claude_desktop: ["user"],
  codex: ["user"],
  cursor: ["project", "user"],
  opencode: ["project", "user"],
  pi: ["project", "user"],
};

function ProviderIcon({ provider }: { provider: Provider }) {
  return (
    <HarnessIcon
      harness={provider === "claude_desktop" ? "claude" : provider}
      className="size-3.5 shrink-0"
    />
  );
}

function McpPicker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);
  return (
    <div ref={anchor} className="relative min-w-0">
      <span className="text-xs text-content/65">{label}</span>
      <Button variant="ghost" size="content"
        ref={trigger}
        type="button"
        aria-label={`${label}: ${selected?.label ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="mt-1 flex h-8 w-full items-center gap-2 rounded-md border border-content/10 bg-content/5 px-2 text-left text-[12px] text-content outline-none hover:border-content/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent justify-start"
      >
        {selected?.icon}
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? value}
        </span>
        <DisclosureChevron expanded={open} direction="down"
          className="size-3.5 shrink-0 text-content/50"
        />
      </Button>
      <Popover
        open={open}
        anchor={anchor}
        side="bottom"
        align="start"
        width={240}
        maxHeight={320}
        layer={LAYER.dialogPopover}
        autoFocus
        onDismiss={() => setOpen(false)}
        role="listbox"
        aria-label={label}
        data-dialog-popover
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const choices = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="option"]',
            ),
          );
          if (choices.length === 0) return;
          const current = choices.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const next =
            current < 0
              ? direction === 1
                ? 0
                : choices.length - 1
              : (current + direction + choices.length) % choices.length;
          choices[next].focus();
        }}
        className="overflow-y-auto overscroll-contain p-1"
      >
        {options.map((option) => (
          <Button data-menu-row="single" variant="ghost" size="content"
            key={option.value}
            type="button"
            role="option"
            aria-selected={value === option.value}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
              trigger.current?.focus();
            }}
            className={cn("flex w-full items-center gap-2 rounded-lg text-left text-[12px] focus-visible:outline-2 focus-visible:outline-accent justify-start", value === option.value ? "bg-selection text-content" : "text-content hover:bg-content/3")}
          >
            {option.icon}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {value === option.value ? (
              <Check className="size-3.5 shrink-0" />
            ) : null}
          </Button>
        ))}
      </Popover>
    </div>
  );
}

function AddServerModal({
  cwd,
  initialProvider,
  onClose,
  onAdded,
}: {
  cwd: string;
  initialProvider: Provider;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const { t: uiT } = useTranslation();
  const schema = z.object({
    provider: z.enum(PROVIDERS),
    scope: z.enum(["local", "project", "user"]),
    name: z.string().trim(),
    config: z.string().refine((value) => {
      try {
        const parsed: unknown = JSON.parse(value);
        return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
      } catch { return false; }
    }, uiT("Configuration must be a JSON object")),
  }).refine(({ provider, name }) => provider === "opencode" || /^[A-Za-z0-9_-]*$/.test(name), {
    path: ["name"], message: uiT("Use only letters, numbers, underscores, or hyphens"),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { provider: initialProvider, scope: SCOPES[initialProvider][0], name: "", config: "" },
  });
  const { provider, scope } = useWatch({ control: form.control });
  const addMutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => withToast(
      () => invoke("mcp_add", { cwd, ...values }),
      { loading: uiT("Adding MCP server…"), success: uiT("MCP server added") },
    ),
    onSuccess: async () => { await onAdded(); onClose(); },
  }, queryClient);
  const busy = addMutation.isPending;
  const error = addMutation.error ? String(addMutation.error) : "";

  return (
    <Modal
      title={uiT("Add MCP server")}
      description={uiT(
        "Paste a server configuration and choose where to add it.",
      )}
      onClose={onClose}
      fitViewport
    >
      <form noValidate onSubmit={form.handleSubmit((values) => { if (!busy) addMutation.mutate(values); })} className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <McpPicker
            label={uiT("Provider")}
            value={provider!}
            options={PROVIDERS.map((option) => ({
              value: option,
              label: MCP_PROVIDER_LABELS[option],
              icon: <ProviderIcon provider={option} />,
            }))}
            onChange={(next) => {
              form.setValue("provider", next);
              form.setValue("scope", SCOPES[next][0]);
            }}
          />
          <McpPicker
            label={uiT("Scope")}
            value={scope!}
            options={SCOPES[provider!].map((option) => ({
              value: option,
              label: option[0].toUpperCase() + option.slice(1),
            }))}
            onChange={(next) => form.setValue("scope", next)}
          />
        </div>
        <label className="block text-xs text-content/65">
          {uiT("Name")}{" "}
          <span className="text-content/40">
            {uiT("(optional for an mcpServers block)")}
          </span>
          <Input data-ui="input"
            {...form.register("name")}
            aria-invalid={!!form.formState.errors.name}
            className="mt-1 block w-full rounded-md border border-stroke bg-content/5 px-2 py-1.5 text-sm text-content outline-none placeholder:text-content/35 focus:border-input-border-hover"
            placeholder="my-server"
          />
          <FieldError errors={[form.formState.errors.name]} />
        </label>
        <label className="block text-xs text-content/65">
          {uiT("JSON configuration")}
          <Textarea data-ui="textarea"
            {...form.register("config")}
            aria-invalid={!!form.formState.errors.config}
            rows={7}
            spellCheck={false}
            className="mt-1 block w-full rounded-md border border-stroke bg-content/5 px-2 py-1.5 font-mono text-xs text-content outline-none placeholder:text-content/35 focus:border-input-border-hover"
            placeholder={
              '{"mcpServers":{"my-server":{"command":"npx","args":["-y","example-mcp"]}}}'
            }
          />
          <FieldError errors={[form.formState.errors.config]} />
        </label>
        <p className="text-xs text-content/45">
          {uiT(
            "Paste one entry from an mcpServers block, or a single server object with a name above.",
          )}
        </p>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400"
          >
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            {uiT("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? uiT("Adding…") : uiT("Add server")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function McpSettings({
  cwd,
  recents = [],
}: {
  cwd: string;
  recents?: RecentProject[];
}) {
  const [selection, setSelection] = useState({ initialCwd: cwd, project: cwd });
  const project = selection.initialCwd === cwd ? selection.project : cwd;
  return (
    <McpConnections
      key={project}
      cwd={project}
      projectPicker={
        <SearchableProjectPicker
          cwd={project}
          railCwd={cwd}
          recents={recents}
          className="w-fit max-w-full shrink-0"
          buttonClassName="h-7.5 max-w-full gap-2 bg-content/5 px-2.5 text-[13px] hover:bg-content/8 active:scale-[0.98]"
          onSelectProject={(path) =>
            setSelection({ initialCwd: cwd, project: path })
          }
        />
      }
    />
  );
}

function McpConnections({
  cwd,
  projectPicker,
}: {
  cwd: string;
  projectPicker: ReactNode;
}) {
  const { t: uiT } = useTranslation();
  const mcp = useMcpSettings(cwd);
  const { servers, claudeError, piError } = mcp;
  const [filter, setFilter] = useState<Filter>("all");
  const [showAllProviders, setShowAllProviders] = useState(false);
  const loading = mcp.fetching;
  const [actionError, setError] = useState("");
  const actionMutation = useMutation({
    mutationFn: ({ server, scope }: { server: ServerRow; scope?: Scope }) => withToast(
      () => scope
        ? invoke("claude_mcp_remove", { cwd, name: server.name, scope })
        : invoke("mcp_provider_login", { cwd, provider: server.provider, name: server.name }),
      { loading: uiT("Saving…"), success: uiT("Saved"), error: false },
    ),
    onSuccess: () => loadMcpSettings(cwd, true),
  }, queryClient);
  const busy = actionMutation.isPending ? actionMutation.variables.server.name : null;
  const error = actionError || (actionMutation.error ? String(actionMutation.error) : mcp.error);
  const [addOpen, setAddOpen] = useState(false);
  const [removeScopes, setRemoveScopes] = useState<Record<string, Scope>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const refresh = useCallback(async () => { await loadMcpSettings(cwd, true); }, [cwd]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? servers
        : servers.filter((server) => server.provider === filter),
    [filter, servers],
  );
  const filterProviders = showAllProviders
    ? PROVIDERS
    : PROVIDERS.filter((provider) =>
        servers.some((server) => server.provider === provider),
      );

  useEffect(() => {
    if (filter !== "all" && !filterProviders.includes(filter)) setFilter("all");
  }, [filter, filterProviders]);

  function login(server: ServerRow) {
    actionMutation.mutate({ server });
  }

  async function remove(server: ServerRow) {
    const selectedScope = server.configPath
      ? server.scope
      : (removeScopes[server.name] ?? "local");
    if (
      !(await ask(`Remove ${server.name} from ${selectedScope} scope?`, {
        title: "Remove MCP server",
      }))
    )
      return;
    actionMutation.mutate({ server, scope: selectedScope });
  }

  return (
    <div
      id="setting-mcp-servers"
      data-setting-id="mcp-servers"
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="desktop-pane-heading text-sm font-semibold">{uiT("MCP connections")}</h2>
            {projectPicker}
          </div>
          <p className="mt-1 text-xs text-content/55">
            {uiT(
              "Configured servers for the selected project and your provider accounts.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="content"
            type="button"
            onClick={() => void refresh()}
            disabled={loading || busy !== null}
            className="flex items-center gap-1.5 rounded-md border border-stroke px-3 py-1.5 text-xs hover:bg-content/3 disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" />
            {uiT("Refresh")}
          </Button>
          <Button variant="ghost" size="content"
            type="button"
            aria-label={
              showAllProviders
                ? uiT("Show available providers")
                : uiT("Show all providers")
            }
            aria-pressed={showAllProviders}
            title={
              showAllProviders
                ? uiT("Showing all providers")
                : uiT("Showing available providers")
            }
            onClick={() => setShowAllProviders(!showAllProviders)}
            className={cn("grid size-7 place-items-center rounded-md border border-content/10 hover:bg-content/3", showAllProviders ? "bg-selection text-content" : "text-content/55")}
          >
            <ListFilter className="size-3.5" />
          </Button>
          <Button variant="ghost" size="content"
            type="button"
            aria-label={uiT("Add MCP server")}
            onClick={() => setAddOpen(true)}
            className="grid size-7 place-items-center rounded-md border border-stroke hover:bg-content/3"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div
        role="group"
        className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
        aria-label={uiT("Filter MCP servers by provider")}
      >
        {(["all", ...filterProviders] as const).map((provider) => (
          <Button variant="ghost" size="content"
            key={provider}
            type="button"
            aria-pressed={filter === provider}
            onClick={() => setFilter(provider)}
            className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-[5px] px-2.5 py-1", filter === provider ? "bg-selection text-content" : "text-content/50 hover:text-content")}
          >
            {provider === "all" ? (
              <Globe className="size-3.5" />
            ) : (
              <ProviderIcon provider={provider} />
            )}
            {provider === "all" ? uiT("All") : MCP_PROVIDER_LABELS[provider]}
            <span className="opacity-60">
              {provider === "all"
                ? servers.length
                : servers.filter((server) => server.provider === provider)
                    .length}
            </span>
          </Button>
        ))}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400"
        >
          {error}
        </p>
      ) : null}
      {claudeError && (filter === "all" || filter === "claude") ? (
        <p className="text-xs text-content/55">
          {uiT("Claude connection status unavailable: ")}
          {claudeError}
        </p>
      ) : null}
      {piError && (filter === "all" || filter === "pi") ? (
        <p className="whitespace-pre-wrap text-xs text-content/55">
          {uiT("Pi MCP status:")} {piError}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-content/55">{uiT("Checking servers…")}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-content/55">
          {uiT("No MCP servers configured for this provider.")}
        </p>
      ) : (
        <div className="desktop-card overflow-hidden rounded-xl border border-content/10 bg-content/3">
          {visible.map((server) => {
            const key = mcpServerKey(server);
            const open = expanded.has(key);
            const inspectable = Boolean(server.configPath);
            return (
              <div
                key={key}
                className="border-b border-content/5 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
                    <ProviderIcon provider={server.provider} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Button variant="ghost" size="content"
                      type="button"
                      disabled={!inspectable}
                      aria-expanded={inspectable ? open : undefined}
                      title={
                        inspectable
                          ? uiT("Show tools, resources and prompts")
                          : uiT(
                              "This server has no local configuration to inspect.",
                            )
                      }
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (!next.delete(key)) next.add(key);
                          return next;
                        })
                      }
                      className="-mx-1 flex max-w-full items-center gap-1 rounded px-1 text-left text-[13px] font-medium text-content enabled:hover:bg-content/3 focus-visible:outline-2 focus-visible:outline-accent justify-start"
                    >
                      <span className="truncate">{server.name}</span>
                      {inspectable ? (
                        <DisclosureChevron expanded={open}
                          className="size-3.5 shrink-0 text-content/45"
                        />
                      ) : null}
                    </Button>
                    <div className="mt-1 text-[12px] leading-relaxed text-content/45">
                      {MCP_PROVIDER_LABELS[server.provider]} · {server.scope} ·{" "}
                      {server.transport || "MCP"} ·{" "}
                      {server.provider === "pi"
                        ? uiT(server.status)
                        : server.status}
                      {server.toolCount != null ? (
                        <>
                          {" "}
                          · {uiT("{count} tools", { count: server.toolCount })}
                        </>
                      ) : null}
                    </div>
                    {server.statusDetail ? (
                      <div className="mt-1 whitespace-pre-wrap text-[11px] text-content/55">
                        {server.statusDetail}
                      </div>
                    ) : null}
                    {server.configPath ? (
                      <div
                        className="truncate text-[11px] text-content/35"
                        title={server.configPath}
                      >
                        {server.configPath}
                      </div>
                    ) : null}
                  </div>
                  {(
                    server.provider === "pi"
                      ? server.nativeState === "needs-auth"
                      : server.provider !== "claude_desktop" &&
                        server.transport &&
                        !["stdio", "local", "ws"].includes(server.transport)
                  ) ? (
                    <Button variant="ghost" size="content"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void login(server)}
                      className="rounded-md border border-stroke px-2 py-1 text-xs hover:bg-content/3 disabled:opacity-50"
                    >
                      {uiT("Sign in")}
                    </Button>
                  ) : null}
                  {server.provider === "claude" ? (
                    <>
                      {!server.configPath ? (
                        <label className="text-xs text-content/55">
                          {uiT("Scope")}{" "}
                          <SearchableSelect searchable={false}
                            label={uiT("Scope to remove {value0} from", {
                              value0: String(server.name),
                            })}
                            value={removeScopes[server.name] ?? "local"}
                            onChange={(value) =>
                              setRemoveScopes((current) => ({
                                ...current,
                                [server.name]: value as Scope,
                              }))
                            }
                            options={[
                              { value: "local", label: uiT("Local") },
                              { value: "project", label: uiT("Project") },
                              { value: "user", label: uiT("User") },
                            ]}
                          />
                        </label>
                      ) : null}
                      <Button variant="ghost" size="content"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void remove(server)}
                        className="rounded-md border border-stroke px-2 py-1 text-xs hover:bg-content/3 disabled:opacity-50"
                      >
                        {uiT("Remove")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="content"
                      type="button"
                      onClick={() =>
                        void revealPath(server.configPath).catch((cause) =>
                          setError(String(cause)),
                        )
                      }
                      className="rounded-md border border-stroke px-2 py-1 text-xs hover:bg-content/3"
                    >
                      {uiT("Show config")}
                    </Button>
                  )}
                </div>
                {inspectable ? (
                  <AnimatedCollapse expanded={open} motion="height">
                    {() => <McpServerDetails cwd={cwd} server={server} />}
                  </AnimatedCollapse>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-content/45">
        {uiT(
          "Claude Code and Pi status comes from their CLIs. Other providers show configured entries. Pi sign-in is available when authentication is required.",
        )}
      </p>
      <PresenceBoundary>{addOpen ? (
        <AddServerModal
          cwd={cwd}
          initialProvider={filter === "all" ? "claude" : filter}
          onClose={() => setAddOpen(false)}
          onAdded={refresh}
        />
      ) : null}</PresenceBoundary>
    </div>
  );
}
