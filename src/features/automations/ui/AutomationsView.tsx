import { Input } from "../../../shared/ui/forms/Input";
import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { automationKeys, automationRunsQuery } from "../model/automationQueries";
import { automationsQuery } from "../model/automations";
import { inboxKeys, inboxConnectionsQuery } from "../../inbox/model/inboxQueries";
import { useProjectBranches } from "../../source-control/hooks/useProjectBranches";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { Switch } from "../../../shared/ui/forms/Switch";
import { AppPageHeader } from "../../workspace/ui/AppPageHeader";
import { translate as translateUi } from "../../../shared/i18n/language";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  File,
  Gauge,
  GitPullRequest,
  Inbox,
  Lock,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  StickyNote,
  Terminal,
  Trash2,
  X,
  Zap,
} from "../../../shared/ui/icons";
import { InboxProviderMark } from "../../inbox/ui/InboxProviderMark";
import { ModelControlPills, ModelPicker } from "../../sessions/ui/ModelPicker";
import { Popover } from "../../../shared/ui/Popover";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SkillPromptField } from "../../skills/ui/SkillPromptField";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import {
  AUTOMATION_WEEKDAYS,
  applyTriggers,
  automationScheduleLabel,
  automationTriggers,
  createAutomationTrigger,
  createManualAutomationRun,
  deleteAutomation,
  draftFromAutomation,
  draftFromTemplate,
  formatAutomationRunAt,
  formatAutomationRunDuration,
  gmtOffsetLabel,
  newAutomationDraft,
  nextAutomationRunAt,
  nextRunPreview,
  saveAutomation,
  setAutomationEnabled,
  subscribeAutomations,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
  type AutomationTrigger,
  type AutomationTriggerKind,
} from "../model/automations";
import {
  AUTOMATION_TEMPLATE_CATEGORIES,
  templatesForCategory,
  type AutomationTemplate,
  type AutomationTemplateCategoryId,
  type AutomationTemplateIcon,
} from "../model/automationTemplates";
import {
  AZUREDEVOPS_CHANGE_EVENT,
} from "../../inbox/model/azureDevOps";
import {
  formatRelativeTime,
} from "../../inbox/model/githubTasks";
import { GITLAB_CHANGE_EVENT } from "../../inbox/model/gitlab";
import { LAYER } from "../../../shared/lib/layers";
import { LINEAR_CHANGE_EVENT } from "../../inbox/model/linear";
import { JIRA_CHANGE_EVENT } from "../../inbox/model/jira";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
  resolveModel,
} from "../../sessions/model/models";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  looksLikeProject,
  type RecentProject,
} from "../../projects/model/recents";
import {
  loadModelControls,
  subscribeModelControls,
} from "../../settings/model/settings";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

type Props = {
  active?: boolean;
  cwd?: string;
  recents: RecentProject[];
  onClose: () => void;
  onLaunch: (
    automation: Automation,
    run: AutomationRun,
  ) => void | Promise<void>;
  onOpenSession: (sessionId: string) => void | Promise<void>;
};

const EMPTY_AUTOMATIONS: Automation[] = [];

let rememberedAutomationId: string | null = null;

export function AutomationsView({
  active = true,
  cwd,
  recents,
  onClose,
  onLaunch,
  onOpenSession,
}: Props) {
  const { t: uiT } = useTranslation();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  return (
    <div
      role="region"
      aria-label={uiT("Automations")}
      data-app-automations
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <AppPageHeader title={uiT("Automations")} icon={Zap} onBack={onClose} />
      <AutomationsContent
        cwd={cwd}
        recents={recents}
        onLaunch={onLaunch}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}

function AutomationsContent({
  cwd,
  recents,
  onLaunch,
  onOpenSession,
}: Pick<Props, "cwd" | "recents" | "onLaunch" | "onOpenSession">) {
  const { t: uiT } = useTranslation();
  const listQuery = useQuery(automationsQuery(), queryClient);
  const automations = listQuery.data ?? EMPTY_AUTOMATIONS;
  const [selectedId, setSelectedId] = useState<string | null>(
    rememberedAutomationId,
  );
  const [query, setQuery] = useState("");
  const loading = listQuery.isPending;
  const [navigationError, setError] = useState<string | null>(null);
  const draftSchema = z.custom<AutomationDraft>().superRefine((draft, ctx) => {
    for (const key of ["name", "prompt", "model"] as const) {
      if (!draft[key].trim()) ctx.addIssue({ code: "custom", path: [key], message: uiT("This field is required") });
    }
    if (!looksLikeProject(draft.cwd)) ctx.addIssue({ code: "custom", path: ["cwd"], message: uiT("Choose a project") });
  });
  const form = useForm({
    resolver: zodResolver(z.object({ draft: draftSchema.nullable() })),
    defaultValues: { draft: null as AutomationDraft | null },
  });
  const draft = useWatch({ control: form.control, name: "draft" });
  const setDraft = (next: AutomationDraft | null) => form.setValue("draft", next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  const [pickerOpen, setPickerOpen] = useState(true);
  const logos = useTabGroupLogos();
  const [groupLabels] = useState(loadTabGroupLabels);
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

  const refresh = useCallback(() => invalidateAfterChange(automationKeys.all), []);
  useEffect(() => subscribeAutomations(() => void refresh()), [refresh]);
  useEffect(() => {
    setSelectedId((current) => {
      const preferred = current ?? rememberedAutomationId;
      return preferred && automations.some((entry) => entry.id === preferred)
        ? preferred : automations[0]?.id ?? null;
    });
  }, [automations]);
  useEffect(() => { rememberedAutomationId = selectedId; }, [selectedId]);
  const { data: runs = [] } = useQuery(automationRunsQuery(selectedId), queryClient);
  const reportError = (reason: Error) => toast.error(errorMessage(reason));
  const saveMutation = useMutation({
    mutationFn: (next: AutomationDraft) => withToast(() => saveAutomation(next), {
      loading: uiT("Saving automation…"), success: uiT("Automation saved"), error: false,
    }),
    onSuccess: async (saved) => {
      setPickerOpen(false); setDraft(null);
      await refresh();
      setSelectedId(saved.id);
    },
    onError: reportError,
  }, queryClient);
  const runMutation = useMutation({
    mutationFn: async (automation: Automation) => {
      const run = await createManualAutomationRun(automation.id);
      await onLaunch(automation, run);
    },
    onSuccess: () => { toast.success(uiT("Automation started")); return refresh(); },
    onError: reportError,
  }, queryClient);
  const deleteMutation = useMutation({
    mutationFn: (automation: Automation) => deleteAutomation(automation.id),
    onSuccess: () => { toast.success(uiT("Automation deleted")); return refresh(); },
    onError: reportError,
  }, queryClient);
  const toggleMutation = useMutation({
    mutationFn: ({ automation, enabled }: { automation: Automation; enabled: boolean }) => setAutomationEnabled(automation, enabled),
    onSuccess: () => { toast.success(uiT("Automation saved")); return refresh(); },
    onError: reportError,
  }, queryClient);
  const saving = saveMutation.isPending;
  const running = runMutation.isPending ? runMutation.variables.id : null;
  const error = navigationError ?? errorMessage(saveMutation.error) ?? errorMessage(runMutation.error)
    ?? errorMessage(deleteMutation.error) ?? errorMessage(toggleMutation.error) ?? errorMessage(listQuery.error) ?? null;

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return automations.filter((automation) => {
      if (!needle) return true;
      const project = resolveTabGroupLabel(
        projectKey(automation.cwd),
        groupLabels,
        projectName(automation.cwd),
      );
      return `${automation.name}\n${automation.prompt}\n${project}\n${automation.cwd}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [automations, groupLabels, query]);
  const selected = automations.find((entry) => entry.id === selectedId) ?? null;

  const defaultDraftTarget = () => {
    const project =
      cwd && looksLikeProject(cwd) ? cwd : (recents[0]?.path ?? "~");
    const preferred = defaultSessionChoice(project);
    const harness = firstEnabledHarness(
      project,
      selected?.harness ?? preferred.harness,
    );
    const model =
      (selected?.harness === harness ? selected.model : undefined) ??
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    return { project, harness, model };
  };

  const beginCreate = () => {
    setPickerOpen(true);
    setDraft(null);
  };

  const beginBlank = () => {
    const { project, harness, model } = defaultDraftTarget();
    setPickerOpen(false);
    setDraft(newAutomationDraft(project, harness, model));
  };

  const beginFromTemplate = (template: AutomationTemplate) => {
    const { project, harness, model } = defaultDraftTarget();
    setPickerOpen(false);
    setDraft(draftFromTemplate(project, harness, model, template));
  };

  const onSave = (nextDraft: AutomationDraft) => {
    form.setValue("draft", nextDraft);
    return form.handleSubmit(({ draft: values }) => {
      if (!saving && values) saveMutation.mutate(values);
    })();
  };
  const onRun = (automation: Automation) => { if (!running) runMutation.mutate(automation); };
  const onDelete = (automation: Automation) => {
    if (window.confirm(uiT("Delete “{name}” and its run history?", { name: automation.name }))) deleteMutation.mutate(automation);
  };
  const onToggle = (automation: Automation, enabled: boolean) => toggleMutation.mutate({ automation, enabled });

  const editorDraft = pickerOpen
    ? null
    : (draft ?? (selected ? draftFromAutomation(selected) : null));
  const listLock = useLockOverscroll<HTMLDivElement>();

  return (
    <div data-automation-columns className="flex min-h-0 min-w-0 flex-1 text-content">
      <aside data-automation-list className="flex w-[280px] shrink-0 flex-col border-r border-stroke">
        <div className="desktop-toolbar flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
          <label className="relative flex h-7 min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 size-3 shrink-0 text-content/40" />
            <span className="sr-only">{uiT("Filter automations")}</span>
            <Input variant="inline"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={uiT("Filter automations")}
              spellCheck={false}
              autoComplete="off"
              className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-[12px] outline-none placeholder:text-content/40"
            />
          </label>
          <Button variant="ghost" size="icon-sm"
            type="button"
            title={uiT("New automation")}
            aria-label={uiT("New automation")}
            onClick={beginCreate}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div
          ref={listLock}
          className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5"
        >
          {loading ? (
            <div className="grid place-items-center py-12 text-content/35">
              <Spinner className="size-4" />
            </div>
          ) : visible.length > 0 ? (
            <ul className="space-y-0.5">
              {visible.map((automation) => (
                <li key={automation.id}>
                  <AutomationCard
                    automation={automation}
                    active={
                      !pickerOpen &&
                      automation.id === selected?.id &&
                      (!draft || draft.id === automation.id)
                    }
                    logos={logos}
                    labels={groupLabels}
                    mascots={groupMascots}
                    colors={groupColors}
                    customColors={groupCustomColors}
                    onSelect={() => {
                      setPickerOpen(false);
                      setDraft(null);
                      setSelectedId(automation.id);
                    }}
                    onToggle={(enabled) => void onToggle(automation, enabled)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-8 text-center text-[12px] text-content/45">
              {query.trim()
                ? uiT("No matching automations")
                : uiT("No automations yet")}
            </p>
          )}
        </div>
      </aside>

      <main data-automation-detail className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error ? (
          <div className="m-4 flex shrink-0 items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-[12px] text-red-300">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        {loading && !editorDraft ? (
          <div className="grid min-h-0 flex-1 place-items-center text-content/35">
            <Spinner className="size-4" />
          </div>
        ) : editorDraft ? (
          <AutomationEditor
            key={editorDraft.id ?? "new"}
            draft={editorDraft}
            recents={recents}
            runs={editorDraft.id ? runs : []}
            saving={saving}
            running={editorDraft.id === running}
            dirty={draft != null}
            onChange={setDraft}
            onClose={() => {
              setDraft(null);
              if (!editorDraft.id) setPickerOpen(true);
            }}
            valid={draftSchema.safeParse(editorDraft).success}
            errors={form.formState.errors.draft ?? undefined}
            onSubmit={(event) => { event.preventDefault(); void onSave(editorDraft); }}
            onRun={
              selected && editorDraft.id
                ? () => void onRun(selected)
                : undefined
            }
            onDelete={
              selected && editorDraft.id
                ? () => void onDelete(selected)
                : undefined
            }
            onOpenSession={async (sessionId) => {
              try {
                await onOpenSession(sessionId);
              } catch (reason: unknown) {
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                );
              }
            }}
          />
        ) : (
          <AutomationPicker onBlank={beginBlank} onPick={beginFromTemplate} />
        )}
      </main>
    </div>
  );
}

function AutomationCard({
  automation,
  active,
  logos,
  labels,
  mascots,
  colors,
  customColors,
  onSelect,
  onToggle,
}: {
  automation: Automation;
  active: boolean;
  logos: Record<string, string>;
  labels: Record<string, string>;
  mascots: Record<string, string>;
  colors: Record<string, number>;
  customColors: Record<string, string>;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { t: uiT } = useTranslation();
  const seed = projectName(automation.cwd);
  const key = projectKey(automation.cwd);
  const project = resolveTabGroupLabel(key, labels, seed);
  const logoPath = resolveTabGroupLogo(key, logos);
  const mascotName = resolveTabGroupMascot(key, mascots);
  const mascotColor = resolveTabGroupColor(key, colors, customColors, seed);
  const lastRun = automation.lastRunAt
    ? formatRelativeTime(new Date(automation.lastRunAt).toISOString())
    : null;
  const model = resolveModel(automation.harness, automation.model);
  return (
    <div
      className={cn("group relative rounded-md border", active
          ? "border-transparent bg-selection"
          : "border-transparent hover:bg-content/3")}
    >
      <Button variant="ghost" size="content"
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={uiT("Open {value0}", { value0: String(automation.name) })}
        onClick={onSelect}
        className="block w-full rounded-md px-2.5 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5 pr-8 text-[10px] text-content/45">
          <TriggerMark
            kind={
              automationTriggers(automation)[0]?.kind ?? automation.triggerKind
            }
            className="size-3"
          />
          <span className="min-w-0 truncate">{triggerLabel(automation)}</span>
        </span>
        <span className="mt-1 block truncate text-[13px] font-semibold text-content">
          {automation.name}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-content/45">
          {logoPath ? (
            <ProjectLogoIcon
              path={logoPath}
              className="size-3.5 shrink-0 rounded-sm"
              imageClassName="size-3.5"
            />
          ) : (
            <ProjectMascot
              project={seed}
              color={mascotColor}
              name={mascotName}
              className="size-3 shrink-0"
            />
          )}
          <span className="min-w-0 truncate">{project}</span>
          {lastRun ? (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{lastRun}</span>
            </>
          ) : null}
          <span
            title={model.name}
            className="ml-auto flex min-w-0 max-w-28 items-center gap-1 text-content/50"
          >
            <HarnessIcon
              harness={automation.harness}
              className="size-3.5 shrink-0"
            />
            <span className="min-w-0 truncate">{model.name}</span>
          </span>
        </span>
      </Button>
      <span className="absolute right-2.5 top-2 flex">
        <Switch
          aria-label={`${automation.enabled ? "Pause" : "Enable"} ${automation.name}`}
          checked={automation.enabled}
          onCheckedChange={onToggle}
          size="sm"
        />
      </span>
    </div>
  );
}

function AutomationPicker({
  onBlank,
  onPick,
}: {
  onBlank: () => void;
  onPick: (template: AutomationTemplate) => void;
}) {
  const { t: uiT } = useTranslation();
  const [category, setCategory] =
    useState<AutomationTemplateCategoryId>("popular");
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const templates = templatesForCategory(category);

  return (
    <div
      ref={lockOverscroll}
      className="automation-picker min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
    >
      <div className="mx-auto w-full max-w-5xl px-8 pt-5 pb-10">
        <h1 className="desktop-page-heading text-[20px] font-semibold leading-tight text-content">
          {uiT("New automation")}
        </h1>
        <p className="mt-1.5 text-[13px] text-content/50">
          {uiT("Pick an example or start from scratch.")}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {AUTOMATION_TEMPLATE_CATEGORIES.map((option) => {
            const selected = option.id === category;
            return (
              <Button variant="ghost" size="content"
                key={option.id}
                type="button"
                onClick={() => setCategory(option.id)}
                aria-pressed={selected}
                className={cn("h-7 rounded-full px-3 text-[12px] font-medium", selected
                    ? "bg-content text-background-base"
                    : "text-content/55 hover:bg-content/5 hover:text-content")}
              >
                {uiT(option.label)}
              </Button>
            );
          })}
        </div>
        <div className="automation-template-grid mt-4 grid grid-cols-1 gap-3">
          <Button variant="secondary" size="content"
            type="button"
            onClick={onBlank}
            className="flex min-h-37 flex-col items-stretch justify-start rounded-xl border border-dashed p-4 text-left"
          >
            <div className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-content/8 text-content/70">
                <Plus className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-content">
                  {uiT("Start from scratch")}
                </span>
                <span className="mt-1 block text-[12px] leading-snug text-content/50">
                  {uiT("Write your own instructions and choose a trigger.")}
                </span>
              </span>
            </div>
          </Button>
          {templates.map((template) => {
            const Icon = TEMPLATE_ICONS[template.icon];
            return (
              <Button variant="secondary" size="content"
                key={template.id}
                type="button"
                onClick={() => onPick(template)}
                className="flex min-h-37 flex-col items-stretch justify-start rounded-xl border p-4 text-left"
              >
                <div className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-content/8 text-content/70">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-content">
                      {uiT(template.name)}
                    </span>
                    <span className="mt-1 block text-[12px] leading-snug text-content/50">
                      {uiT(template.description)}
                    </span>
                  </span>
                </div>
                <span className="mt-auto flex min-w-0 items-center gap-1.5 pt-3 text-[11px] text-content/45">
                  <TriggerMark
                    kind={template.trigger.kind}
                    className="size-3"
                  />
                  <span className="min-w-0 truncate">
                    {template.triggerLabel}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const RUN_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_9.5rem_6.75rem_3.5rem] items-center gap-4 px-4";

function RunRow({
  run,
  draft,
  onOpenSession,
}: {
  run: AutomationRun;
  draft: AutomationDraft;
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  const { t: uiT } = useTranslation();
  const trigger = runTriggerMeta(run, draft);
  const sessionId = run.sessionId;
  return (
    <li>
      <Button variant="ghost" size="content"
        type="button"
        disabled={!sessionId}
        title={
          sessionId
            ? uiT("Open session")
            : (run.error ?? uiT("This run has no session yet"))
        }
        onClick={() => {
          if (!sessionId) return;
          void onOpenSession(sessionId);
        }}
        className={cn(RUN_GRID, "h-11 w-full text-left text-[13px] disabled:opacity-100", sessionId ? "cursor-pointer hover:bg-content/3" : "cursor-default")}
      >
        <span className="flex min-w-0 items-center gap-2 text-content">
          <TriggerMark
            kind={trigger.kind}
            className="size-3.5 shrink-0 text-content/40"
          />
          <span className="min-w-0 truncate">{trigger.label}</span>
        </span>
        <span className="truncate text-content/70">
          {formatAutomationRunAt(run.scheduledFor || run.createdAt)}
        </span>
        <span>
          <RunStatusPill status={run.status} />
        </span>
        <span className="text-right tabular-nums text-content/55">
          {formatAutomationRunDuration(run)}
        </span>
      </Button>
    </li>
  );
}

function RunStatusPill({ status }: { status: AutomationRun["status"] }) {
  const running = status === "running";
  return (
    <span
      className={cn("inline-flex h-5 max-w-full items-center gap-1 rounded-full px-2 text-[11px] font-medium", runStatusTone(status))}
    >
      {running ? (
        <Spinner className="size-2.5 shrink-0" />
      ) : null}
      {runStatusLabel(status)}
    </span>
  );
}

function runStatusLabel(status: AutomationRun["status"]): string {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "cancelled") return "Cancelled";
  if (status === "running") return "Running";
  return "Pending";
}

function runStatusTone(status: AutomationRun["status"]): string {
  if (status === "succeeded") return "bg-emerald-500/12 text-emerald-400";
  if (status === "failed") return "bg-rose-500/12 text-rose-400";
  if (status === "skipped") return "bg-amber-500/12 text-amber-400";
  if (status === "cancelled") return "bg-content/8 text-content/50";
  return "bg-blue-500/12 text-blue-400";
}

function runTriggerMeta(
  run: AutomationRun,
  draft: AutomationDraft,
): { kind: AutomationTriggerKind; label: string } {
  if (run.trigger === "manual")
    return { kind: "time", label: translateUi("Test run") };
  if (run.trigger === "event") {
    const kind = run.eventKind ?? draft.triggerKind;
    const event = run.event ?? draft.triggerEvent;
    return {
      kind,
      label: findTriggerEvent(kind, event)?.label ?? triggerName(kind),
    };
  }
  const times = draft.triggers.filter((trigger) => trigger.kind === "time");
  if (times[0]) {
    return {
      kind: "time",
      label: translateUi("Scheduled · {value0}", {
        value0: automationScheduleLabel(times[0]),
      }),
    };
  }
  const first = draft.triggers[0];
  if (!first) return { kind: "time", label: translateUi("Scheduled") };
  const event =
    findTriggerEvent(first.kind, first.event)?.label ?? triggerName(first.kind);
  return { kind: first.kind, label: event };
}

function AutomationEditor({
  draft,
  recents,
  runs,
  saving,
  running,
  dirty,
  onChange,
  onClose,
  onSubmit,
  errors,
  valid,
  onRun,
  onDelete,
  onOpenSession,
}: {
  draft: AutomationDraft;
  recents: RecentProject[];
  runs: AutomationRun[];
  saving: boolean;
  running: boolean;
  dirty: boolean;
  onChange: (draft: AutomationDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  errors?: FieldErrors<AutomationDraft>;
  valid: boolean;
  onRun?: () => void;
  onDelete?: () => void;
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  const { t: uiT } = useTranslation();
  const [tab, setTab] = useState<"settings" | "history">("settings");
  const settingsTabId = useId();
  const historyTabId = useId();
  const tabPanelId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerQuery, setTriggerQuery] = useState("");
  const [triggerCategory, setTriggerCategory] =
    useState<AutomationTriggerKind | null>(null);
  const triggerButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const triggerCategoryAnchors = useRef<
    Partial<Record<AutomationTriggerKind, HTMLButtonElement>>
  >({});
  const { data: providerConnected } = useQuery(inboxConnectionsQuery(), queryClient);
  const controlsBeside =
    useSyncExternalStore(subscribeModelControls, loadModelControls) ===
    "beside";
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  useEffect(() => {
    const load = () => void invalidateAfterChange(inboxKeys.connections);
    const events = [LINEAR_CHANGE_EVENT, JIRA_CHANGE_EVENT, GITLAB_CHANGE_EVENT, AZUREDEVOPS_CHANGE_EVENT];
    for (const event of events) window.addEventListener(event, load);
    return () => { for (const event of events) window.removeEventListener(event, load); };
  }, []);
  const triggerReady = (kind: AutomationTriggerKind) => {
    if (kind === "time") return true;
    return providerConnected[kind];
  };
  const update = <K extends keyof AutomationDraft>(
    key: K,
    value: AutomationDraft[K],
  ) => onChange({ ...draft, [key]: value });
  const triggerCategories = useMemo(
    () =>
      TRIGGER_CATEGORIES.filter((option) =>
        option.label
          .toLocaleLowerCase()
          .includes(triggerQuery.toLocaleLowerCase()),
      ),
    [triggerQuery],
  );
  useEffect(() => {
    if (
      triggerCategory &&
      !triggerCategories.some((option) => option.value === triggerCategory)
    ) {
      setTriggerCategory(null);
    }
  }, [triggerCategories, triggerCategory]);
  const setTriggers = (triggers: AutomationTrigger[]) =>
    onChange(applyTriggers(draft, triggers));
  const selectTrigger = (kind: AutomationTriggerKind, event: TriggerEvent) => {
    if (draft.triggers.length >= 20 || !triggerReady(kind)) {
      setTriggerCategory(null);
      setTriggerOpen(false);
      return;
    }
    setTriggers([
      ...draft.triggers,
      createAutomationTrigger(kind, event.value),
    ]);
    setTriggerCategory(null);
    setTriggerOpen(false);
  };
  const updateTrigger = (next: AutomationTrigger) =>
    setTriggers(
      draft.triggers.map((trigger) =>
        trigger.id === next.id ? next : trigger,
      ),
    );

  const historyAvailable = Boolean(draft.id);
  const showingHistory = historyAvailable && tab === "history";

  return (
    <form noValidate className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={onSubmit}>
      <div className="relative w-full shrink-0 border-b border-stroke">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2.5 px-8 pt-5">
          <header className="flex flex-col gap-2.5">
            <FieldError errors={[errors?.name, errors?.cwd, errors?.model]} />
            <div className="flex items-start gap-6">
              <Input variant="inline"
                autoFocus
                aria-label={uiT("Automation name")}
                aria-invalid={!!errors?.name}
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder={uiT("Untitled")}
                className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold leading-tight text-content outline-none placeholder:text-content/35"
              />
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {!draft.id || dirty ? (
                  <Button variant="secondary" size="sm"
                    type="button"
                    onClick={onClose}
                  >
                    {draft.id ? uiT("Reset") : uiT("Cancel")}
                  </Button>
                ) : null}
                {onRun ? (
                  <Button variant="secondary" size="sm"
                    type="button"
                    onClick={onRun}
                    disabled={running}
                  >
                    {running ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                    {uiT("Run now")}
                  </Button>
                ) : null}
                <Button variant="primary" size="sm"
                  type="submit"
                  disabled={!valid || saving || (!!draft.id && !dirty)}
                >
                  {saving ? (
                    <Spinner className="size-3.5" />
                  ) : null}
                  {draft.id ? uiT("Save") : uiT("Create")}
                </Button>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[12px] text-content/50">
              <Switch
                aria-label={
                  draft.enabled
                    ? uiT("Pause automation")
                    : uiT("Enable automation")
                }
                checked={draft.enabled}
                onCheckedChange={(enabled) => update("enabled", enabled)}
                size="sm"
              />
              <span className="shrink-0">
                {draft.enabled ? uiT("Active") : uiT("Inactive")}
              </span>
              <span
                aria-hidden
                className="h-3 ml-2 w-px shrink-0 bg-content/15"
              />
              <SearchableProjectPicker
                cwd={draft.cwd}
                recents={recents}
                onSelectProject={(cwd) =>
                  onChange({ ...draft, cwd, sessionFolderId: "" })
                }
              />
              {onDelete ? (
                <>
                  <span
                    aria-hidden
                    className="h-3 w-px shrink-0 bg-content/15"
                  />
                  <Button variant="ghost" size="icon-sm"
                    ref={menuButton}
                    type="button"
                    title={uiT("Automation actions")}
                    aria-label={uiT("Automation actions")}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                  <PresenceBoundary propagate>{menuOpen ? (
                    <Popover
                      anchor={menuButton}
                      side="bottom"
                      align="start"
                      gap={4}
                      width={200}
                      constrainHeight={false}
                      role="menu"
                      aria-label={uiT("Automation actions")}
                      onDismiss={(reason) => {
                        setMenuOpen(false);
                        if (reason === "escape") menuButton.current?.focus({ preventScroll: true });
                      }}
                      className="p-1"
                    >
                      <Button variant="ghost" size="content"
                        type="button"
                        role="menuitem"
                        data-variant="destructive"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete();
                        }}
                        className="w-full justify-start text-left"
                      >
                        <MenuHover />
                        <Trash2 className="size-3.5" />
                        {uiT("Delete automation")}
                      </Button>
                    </Popover>
                  ) : null}</PresenceBoundary>
                </>
              ) : null}
            </div>
          </header>
          {historyAvailable ? (
            <div
              role="tablist"
              aria-label={uiT("Automation view")}
              className="flex h-9 items-stretch gap-4"
            >
              <PageTab
                id={settingsTabId}
                controls={tabPanelId}
                label={uiT("Settings")}
                selected={!showingHistory}
                onSelect={() => setTab("settings")}
              />
              <PageTab
                id={historyTabId}
                controls={tabPanelId}
                label={uiT("Run history")}
                selected={showingHistory}
                onSelect={() => setTab("history")}
              />
            </div>
          ) : (
            <div className="pb-5" />
          )}
        </div>
      </div>

      <div
        ref={lockOverscroll}
        id={historyAvailable ? tabPanelId : undefined}
        role={historyAvailable ? "tabpanel" : undefined}
        aria-labelledby={
          historyAvailable
            ? showingHistory
              ? historyTabId
              : settingsTabId
            : undefined
        }
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
      >
        {!showingHistory ? (
          <div className="mx-auto w-full max-w-5xl space-y-8 px-8 py-5 pb-10">
            <section>
              <SectionTitle>{uiT("Triggers")}</SectionTitle>
              <div className="mt-3 rounded-md border border-content/10">
                {draft.triggers.length > 0 ? (
                  <ul className="px-3 py-1.5">
                    {draft.triggers.map((trigger) => (
                      <li key={trigger.id}>
                        <TriggerRow
                          trigger={trigger}
                          cwd={draft.cwd}
                          onChange={updateTrigger}
                          onRemove={() =>
                            setTriggers(
                              draft.triggers.filter(
                                (entry) => entry.id !== trigger.id,
                              ),
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {draft.triggers.length > 0 ? (
                  <div className="border-t border-content/8" />
                ) : null}
                <Button variant="ghost" size="content"
                  ref={triggerButton}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={triggerOpen}
                  disabled={draft.triggers.length >= 20}
                  onClick={() => {
                    setTriggerQuery("");
                    setTriggerCategory(null);
                    setTriggerOpen((open) => !open);
                  }}
                  className={cn("flex h-12 w-full items-center justify-start gap-2 px-3 text-left text-[13px] text-content/55", draft.triggers.length > 0 ? "rounded-b-md" : "rounded-md")}
                >
                  <Plus className="size-3.5" />
                  {uiT("Add Trigger")}
                </Button>
              </div>
              <PresenceBoundary propagate>{triggerOpen ? (
                <Popover
                  anchor={triggerButton}
                  side="bottom"
                  align="start"
                  gap={4}
                  width={250}
                  role="menu"
                  aria-label={uiT("Choose automation trigger")}
                  layer={LAYER.popover}
                  ignore="[data-trigger-submenu]"
                  onDismiss={(reason) => {
                    setTriggerCategory(null);
                    setTriggerOpen(false);
                    if (reason === "escape") triggerButton.current?.focus({ preventScroll: true });
                  }}
                  className="overflow-hidden"
                >
                  <label className="flex h-11 items-center gap-2.5 border-b border-stroke px-3 text-content/45 focus-within:text-content/70">
                    <Search className="size-3.5 shrink-0" />
                    <span className="sr-only">{uiT("Search triggers")}</span>
                    <Input variant="inline"
                      autoFocus
                      value={triggerQuery}
                      onChange={(event) => setTriggerQuery(event.target.value)}
                      placeholder={uiT("Search triggers")}
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/35"
                    />
                  </label>
                  <div className="p-1">
                    {triggerCategories.map((option) => {
                      const ready = triggerReady(option.value);
                      return (
                        <Button variant="ghost" size="content"
                          key={option.value}
                          ref={(node) => {
                            if (node)
                              triggerCategoryAnchors.current[option.value] =
                                node;
                            else
                              delete triggerCategoryAnchors.current[
                                option.value
                              ];
                          }}
                          type="button"
                          role="menuitem"
                          aria-haspopup={ready ? "menu" : undefined}
                          aria-expanded={triggerCategory === option.value}
                          aria-disabled={ready ? undefined : true}
                          title={
                            ready
                              ? undefined
                              : uiT("Connect {value0} in Settings", {
                                  value0: String(option.label),
                                })
                          }
                          onMouseEnter={() =>
                            setTriggerCategory(ready ? option.value : null)
                          }
                          onFocus={() =>
                            setTriggerCategory(ready ? option.value : null)
                          }
                          onClick={() => {
                            if (!ready) return;
                            setTriggerCategory(option.value);
                          }}
                          className={cn("w-full justify-start text-left", !ready
                              ? "cursor-default text-content/35"
                              : triggerCategory === option.value
                                ? "bg-selection text-content"
                                : "text-content/70 hover:bg-content/3 hover:text-content")}
                        >
                          <MenuHover />
                          <TriggerMark
                            kind={option.value}
                            className="size-3.5 shrink-0"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {uiT(option.label)}
                          </span>
                          {ready ? (
                            <ChevronRight className="size-3.5 text-content/45" />
                          ) : (
                            <span className="shrink-0 text-[11px] text-content/35">
                              {uiT("Not connected")}
                            </span>
                          )}
                        </Button>
                      );
                    })}
                    {triggerCategories.length === 0 ? (
                      <p className="px-2 py-5 text-center text-[12px] text-content/40">
                        {uiT("No matching triggers")}
                      </p>
                    ) : null}
                  </div>
                </Popover>
              ) : null}</PresenceBoundary>
              <PresenceBoundary propagate>{triggerOpen &&
              triggerCategory &&
              triggerCategories.some(
                (option) => option.value === triggerCategory,
              ) &&
              triggerReady(triggerCategory) ? (
                <Popover
                  anchor={
                    triggerCategoryAnchors.current[triggerCategory] ?? null
                  }
                  side="right"
                  align="start"
                  gap={4}
                  width={220}
                  maxHeight={360}
                  role="menu"
                  aria-label={uiT("{value0} events", {
                    value0: String(triggerName(triggerCategory)),
                  })}
                  layer={LAYER.submenu}
                  data-trigger-submenu
                  onDismiss={(reason) => {
                    if (reason === "escape") {
                      triggerCategoryAnchors.current[triggerCategory]?.focus({ preventScroll: true });
                      setTriggerCategory(null);
                    }
                  }}
                  className="overflow-y-auto p-1"
                >
                  {TRIGGER_EVENTS[triggerCategory].map((event) => (
                    <Button variant="ghost" size="content"
                      key={event.value}
                      type="button"
                      role="menuitem"
                      onClick={() => selectTrigger(triggerCategory, event)}
                      className="w-full justify-start text-left"
                    >
                      <MenuHover />
                      {uiT(event.label)}
                    </Button>
                  ))}
                </Popover>
              ) : null}</PresenceBoundary>
            </section>

            <section>
              <SectionTitle>{uiT("Instructions")}</SectionTitle>
              <div className="relative mt-3 rounded-md border border-content/10 bg-content/3 backdrop-blur-sm has-focus:border-content/20">
                <PromptField
                  invalid={!!errors?.prompt}
                  value={draft.prompt}
                  harness={draft.harness}
                  cwd={draft.cwd}
                  onChange={(prompt) => update("prompt", prompt)}
                />
                <div className="flex items-center gap-1 px-2 pb-2">
                  <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
                    <div className="flex shrink-0 items-center gap-1">
                      <ModelPicker
                        harness={draft.harness}
                        model={draft.model}
                        values={draft.modelSettings}
                        project={draft.cwd}
                        hideSettings={controlsBeside}
                        onChange={(harness, model) =>
                          onChange({ ...draft, harness, model })
                        }
                        onSettingsChange={(modelSettings) =>
                          update("modelSettings", modelSettings)
                        }
                      />
                      {controlsBeside ? (
                        <ModelControlPills
                          harness={draft.harness}
                          model={draft.model}
                          values={draft.modelSettings}
                          onSettingsChange={(modelSettings) =>
                            update("modelSettings", modelSettings)
                          }
                        />
                      ) : null}
                      {draft.harness !== "fx" ? (
                        <AccessPicker
                          value={draft.runtimeMode}
                          onChange={(runtimeMode) =>
                            update("runtimeMode", runtimeMode)
                          }
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <FieldError errors={[errors?.prompt]} />
              <p className="mt-2 px-1 text-[11px] text-content/35">
                {uiT(
                  "Skills, @file references, and built-in commands work here.",
                )}
              </p>
            </section>

            <section>
              <SectionTitle>{uiT("Session")}</SectionTitle>
              <div className="mt-3 divide-y divide-content/7 rounded-md border border-content/10">
                <SettingsRow
                  label={uiT("Working copy")}
                  hint={uiT("This repo, or a fresh worktree")}
                >
                  <SettingsSelect
                    label={uiT("Working copy")}
                    value={
                      draft.workspaceMode === "worktree"
                        ? "worktree"
                        : "current"
                    }
                    options={WORKSPACE_OPTIONS.map((option) => ({
                      ...option,
                      label: uiT(option.label),
                    }))}
                    onChange={(value) =>
                      onChange({
                        ...draft,
                        workspaceMode: value as "current" | "worktree",
                        executionCwd: "",
                        reuseSession: value === "current" && draft.reuseSession,
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow
                  label={uiT("Conversation")}
                  hint={uiT("New chat, or continue the last run")}
                >
                  <SettingsSelect
                    label={uiT("Conversation")}
                    value={draft.reuseSession ? "reuse" : "fresh"}
                    disabled={draft.workspaceMode === "worktree"}
                    options={CONVERSATION_OPTIONS.map((option) => ({
                      ...option,
                      label: uiT(option.label),
                    }))}
                    onChange={(value) =>
                      update("reuseSession", value === "reuse")
                    }
                  />
                </SettingsRow>
              </div>
            </section>

            <details className="rounded-md border border-content/10">
              <summary className="flex min-h-14 cursor-default list-none items-center justify-between gap-3 px-4 active:opacity-75">
                <span>
                  <span className="block text-[13px] font-medium text-content/75">
                    {uiT("Advanced")}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-content/40">
                    {uiT("Catch-up window for missed runs")}
                  </span>
                </span>
                <ChevronDown className="size-3.5 text-content/40" />
              </summary>
              <div className="divide-y divide-content/7 border-t border-content/8">
                <SettingsRow
                  label={uiT("Missed-run grace")}
                  hint={uiT("Catch up if a scheduled run was missed")}
                >
                  <SettingsSelect
                    label={uiT("Missed-run grace")}
                    value={String(draft.missedRunGraceMinutes)}
                    options={GRACE_OPTIONS.map((option) => ({
                      ...option,
                      label: uiT(option.label),
                    }))}
                    onChange={(value) =>
                      update("missedRunGraceMinutes", Number(value))
                    }
                  />
                </SettingsRow>
              </div>
            </details>
          </div>
        ) : (
          <section className="mx-auto w-full max-w-5xl px-8 py-5 pb-10">
            <SectionTitle>{uiT("Run history")}</SectionTitle>
            {runs.length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-md border border-content/10">
                <div className={cn(RUN_GRID, "h-10 text-[11px] text-content/40")}>
                  <span>{uiT("Trigger")}</span>
                  <span>{uiT("Triggered")}</span>
                  <span>{uiT("Status")}</span>
                  <span className="text-right">{uiT("Duration")}</span>
                </div>
                <ul className="divide-y divide-content/8 border-t border-content/8">
                  {runs.slice(0, 100).map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      draft={draft}
                      onOpenSession={onOpenSession}
                    />
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-content/10 px-4 py-16 text-center text-[12px] text-content/40">
                {uiT("This automation has not run yet.")}
              </div>
            )}
          </section>
        )}
      </div>
    </form>
  );
}

function PromptField({
  invalid,
  value,
  harness,
  cwd,
  onChange,
}: {
  invalid?: boolean;
  value: string;
  harness: AutomationDraft["harness"];
  cwd: string;
  onChange: (value: string) => void;
}) {
  return (
    <SkillPromptField
      invalid={invalid}
      value={value}
      harness={harness}
      cwd={cwd}
      onChange={onChange}
    />
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="desktop-section-heading px-1 text-[12px] font-medium text-content/50">{children}</h2>
  );
}

function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-[12px] text-content/75">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-content/40">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

function SettingsSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <SearchableSelect
      variant="pill"
      searchable={false}
      align="end"
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

function PageTab({
  id,
  controls,
  label,
  selected,
  onSelect,
}: {
  id: string;
  controls: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button variant="ghost" size="content"
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      onClick={onSelect}
      className="surface-tab relative flex h-7.5 items-center px-2 text-[12px] leading-none"
    >
      {label}
    </Button>
  );
}

const WORKSPACE_OPTIONS = [
  { value: "current", label: "Current" },
  { value: "worktree", label: "Fresh worktree" },
] as const;

const CONVERSATION_OPTIONS = [
  { value: "fresh", label: "Start fresh" },
  { value: "reuse", label: "Continue last" },
] as const;

const GRACE_OPTIONS = [
  { value: "0", label: "Do not catch up" },
  { value: "30", label: "30 minutes" },
  { value: "120", label: "2 hours" },
  { value: "720", label: "12 hours" },
  { value: "1440", label: "24 hours" },
] as const;

const TEMPLATE_ICONS: Record<AutomationTemplateIcon, typeof Search> = {
  search: Search,
  alert: AlertCircle,
  file: File,
  check: CheckCircle,
  lock: Lock,
  pr: GitPullRequest,
  inbox: Inbox,
  gauge: Gauge,
  terminal: Terminal,
  note: StickyNote,
};

const TRIGGER_CATEGORIES: readonly {
  value: AutomationTriggerKind;
  label: string;
}[] = [
  { value: "time", label: "Scheduled" },
  { value: "github", label: "GitHub" },
  { value: "linear", label: "Linear" },
  { value: "jira", label: "Jira" },
  { value: "gitlab", label: "GitLab" },
  { value: "azuredevops", label: "Azure DevOps" },
];

type TriggerEvent = {
  value: string;
  label: string;
};

const TRIGGER_EVENTS: Record<AutomationTriggerKind, readonly TriggerEvent[]> = {
  time: [
    { value: "hourly", label: "Hourly" },
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
  ],
  github: [
    { value: "draft_opened", label: "Draft opened" },
    { value: "pull_request_opened", label: "Pull request opened" },
    { value: "issue_opened", label: "Issue opened" },
  ],
  linear: [{ value: "issue_created", label: "Issue created" }],
  jira: [{ value: "issue_created", label: "Issue appeared" }],
  gitlab: [
    { value: "merge_request_opened", label: "Merge request opened" },
    { value: "issue_opened", label: "Issue opened" },
  ],
  azuredevops: [
    { value: "pull_request_appeared", label: "Pull request appeared" },
    { value: "work_item_appeared", label: "Work item appeared" },
  ],
};

function TriggerMark({
  kind,
  className,
}: {
  kind: AutomationTriggerKind;
  className?: string;
}) {
  if (kind === "time") {
    return <Clock className={className} />;
  }
  return <InboxProviderMark provider={kind} className={className} />;
}

function triggerName(kind: AutomationTriggerKind): string {
  return translateUi(
    TRIGGER_CATEGORIES.find((option) => option.value === kind)?.label ?? kind,
  );
}

function findTriggerEvent(
  kind: AutomationTriggerKind,
  value: string,
): TriggerEvent | undefined {
  return TRIGGER_EVENTS[kind].find((event) => event.value === value);
}

function triggerLabel(automation: Automation): string {
  const triggers = automationTriggers(automation);
  if (triggers.length === 0) return "No trigger";
  const first = triggers[0]!;
  const label =
    first.kind === "time"
      ? automationScheduleLabel(first)
      : (findTriggerEvent(first.kind, first.event)?.label ??
        triggerName(first.kind));
  return triggers.length > 1
    ? `${translateUi(label)} +${triggers.length - 1}`
    : translateUi(label);
}

function TriggerRow({
  trigger,
  cwd,
  onChange,
  onRemove,
}: {
  trigger: AutomationTrigger;
  cwd: string;
  onChange: (trigger: AutomationTrigger) => void;
  onRemove: () => void;
}) {
  const { t: uiT } = useTranslation();
  const projectPath = looksLikeProject(cwd) ? cwd : "";
  const push = trigger.event === "push_to_branch";
  const branchInfo = useProjectBranches(projectPath, push);
  const branches = branchInfo?.branches.map((branch) => branch.name) ?? [];
  const branchOptions = branches.map((name) => ({ value: name, label: name }));
  if (
    trigger.branch &&
    !branchOptions.some((option) => option.value === trigger.branch)
  ) {
    branchOptions.unshift({ value: trigger.branch, label: trigger.branch });
  }
  const nextAt = trigger.kind === "time" ? nextAutomationRunAt(trigger) : 0;

  return (
    <div className="group flex min-h-10 items-center gap-2.5 py-1">
      <TriggerMark
        kind={trigger.kind}
        className="size-3.5 shrink-0 text-content/45"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-content/70">
        {trigger.kind === "time" ? (
          <TimeTriggerSentence
            trigger={trigger}
            nextAt={nextAt}
            onChange={onChange}
          />
        ) : (
          <EventTriggerSentence
            trigger={trigger}
            branchOptions={branchOptions}
            projectChosen={Boolean(projectPath)}
            onChange={onChange}
          />
        )}
      </div>
      <Button variant="ghost" size="icon-sm"
        type="button"
        aria-label={uiT("Remove trigger")}
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function TimeTriggerSentence({
  trigger,
  nextAt,
  onChange,
}: {
  trigger: AutomationTrigger;
  nextAt: number;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t: uiT } = useTranslation();
  const dayOptions = AUTOMATION_WEEKDAYS.map((label, value) => ({
    value: String(value),
    label: uiT(label),
  }));
  const minuteOptions = [0, 15, 30, 45].map((value) => ({
    value: String(value),
    label: `:${String(value).padStart(2, "0")}`,
  }));
  const prefix =
    trigger.scheduleKind === "hourly"
      ? "Every hour at"
      : trigger.scheduleKind === "daily"
        ? "Every day at"
        : trigger.scheduleKind === "weekdays"
          ? "Every weekday at"
          : "Every week on";
  return (
    <>
      <span>{uiT(prefix)}</span>
      {trigger.scheduleKind === "weekly" ? (
        <>
          <TriggerPill
            label={uiT("Day")}
            value={String(trigger.dayOfWeek)}
            options={dayOptions}
            onChange={(value) =>
              onChange({ ...trigger, dayOfWeek: Number(value) })
            }
          />
          <span>{uiT("at")}</span>
        </>
      ) : null}
      {trigger.scheduleKind === "hourly" ? (
        <TriggerPill
          label={uiT("Minute")}
          value={String(trigger.minute)}
          options={minuteOptions}
          onChange={(value) => onChange({ ...trigger, minute: Number(value) })}
        />
      ) : (
        <TriggerPill
          label={uiT("Time")}
          value={trigger.time}
          options={timeOptions(trigger.time)}
          onChange={(value) => onChange({ ...trigger, time: value })}
        />
      )}
      <span className="text-content/45">{gmtOffsetLabel()}</span>
      <span className="ml-1 text-content/35">{nextRunPreview(nextAt)}</span>
    </>
  );
}

function EventTriggerSentence({
  trigger,
  branchOptions,
  projectChosen,
  onChange,
}: {
  trigger: AutomationTrigger;
  branchOptions: { value: string; label: string }[];
  projectChosen: boolean;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t: uiT } = useTranslation();
  const stem =
    trigger.event === "push_to_branch"
      ? "Push"
      : (findTriggerEvent(trigger.kind, trigger.event)?.label ?? trigger.event);
  const push = trigger.event === "push_to_branch";
  return (
    <>
      <span>{uiT(stem)}</span>
      {push ? (
        <>
          <span>{uiT("on")}</span>
          <TriggerPill
            label={uiT("Branch")}
            value={trigger.branch}
            options={branchOptions}
            placeholder={uiT("Select a branch")}
            disabled={!projectChosen}
            emptyLabel={
              projectChosen ? "No branches found" : "Choose a project first"
            }
            onChange={(value) => onChange({ ...trigger, branch: value })}
          />
        </>
      ) : null}
      <span>{uiT("by")}</span>
      <TriggerPill
        label={uiT("Actor")}
        value={trigger.actor || "anyone"}
        options={[{ value: "anyone", label: uiT("Anyone") }]}
        onChange={(value) => onChange({ ...trigger, actor: value })}
      />
    </>
  );
}

function TriggerPill({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; keywords?: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  return (
    <SearchableSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      emptyLabel={emptyLabel}
      variant="pill"
      searchable={options.length > 8}
    />
  );
}

function timeOptions(current: string) {
  const options = Array.from({ length: 24 }, (_, hour) => {
    const prefix = String(hour).padStart(2, "0");
    return [
      { value: `${prefix}:00`, label: `${prefix}:00` },
      { value: `${prefix}:30`, label: `${prefix}:30` },
    ];
  }).flat();
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
}
