import { Switch } from "../../../shared/ui/forms/Switch";
import { BOT_WORKTREE_IDLE_MINUTES } from "../../../integrations/harness/core/botAutonomy";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type {
  BotMemoryDetailProps,
  BotSelectProps,
} from "./BotChatChrome";
import {
  BOT_PERMISSIONS,
  BOT_PERSONA_PRESETS,
  defaultBotPersona,
  fullBotPolicy,
  type BotPatch,
  type BotPolicy,
  type BotWatch,
  type BotPersona,
  type BotPersonaPreset,
  type BotPermission,
  type BotConfiguration,
} from "../model/botView";
import type {
  HostModelCatalog,
  HostProject,
  RemoteProvider,
} from "../../connections/model/protocol";
import {
  HARNESS_TITLE,
  RUNTIME_MODES,
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  type RuntimeMode,
} from "../../sessions/model/session";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { BotMemoryEditor } from "./BotMemory";
import { BotMemoryDialog } from "./BotMemoryDialog";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { BotImSettings } from "./BotImSettings";
import { BotHabits, type HabitControl } from "./BotHabits";
import type { BotHabit } from "../model/botHabits";
import type { BotRpc } from "../model/botRpc";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { isEffortSettingId } from "../../sessions/model/models";
import { carryModelSettings, findRemoteModel, remoteModelControls } from "../../connections/model/remoteModels";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { followSessionProjects, isExplicitlyWatchedSession, isWatchedSession, removeWatchedSession } from "../model/botSessions";
import { sessionDisplayTitle } from "../../sessions/model/session";
import { ChevronDown, X } from "../../../shared/ui/icons";

const labels: Record<string, string> = {
  "catalog.read": "View agents and models",
  "projects.read": "View projects",
  "projects.open": "Open projects",
  "sessions.read": "View conversations",
  "sessions.create": "Create conversations",
  "sessions.send": "Send messages",
  "sessions.configure": "Configure conversations",
  "sessions.cancel": "Stop conversations",
  "sessions.approve": "Approve agent actions",
  "sessions.answer": "Answer agent questions",
  "sessions.queue": "Manage message queues",
  "sessions.metadata": "Rename and archive conversations",
  "sessions.delete": "Delete conversations",
  "orchestration.control": "Manage orchestration",
  "files.read": "Read project files",
  "files.write": "Modify project files",
  "git.read": "View Git status",
  "git.write": "Modify Git state",
  "git.publish": "Publish Git changes",
};
const permissionGroups: { label: string; keys: BotPermission[] }[] = [
  {
    label: "Projects and agents",
    keys: ["catalog.read", "projects.read", "projects.open"],
  },
  {
    label: "Conversations",
    keys: BOT_PERMISSIONS.filter(
      (key) => key.startsWith("sessions.") || key === "orchestration.control",
    ),
  },
  { label: "Files", keys: ["files.read", "files.write"] },
  { label: "Git", keys: ["git.read", "git.write", "git.publish"] },
];
const personaLabels: Record<BotPersonaPreset, string> = {
  secretary: "Organized secretary",
  partner: "Easygoing partner",
  engineer: "Meticulous engineer",
  custom: "Custom",
};
const personaHints: Record<BotPersonaPreset, string> = {
  secretary:
    "Brief and warm, confirms what it does and keeps track of loose ends.",
  partner: "Casual like a colleague in chat, with the occasional emoji.",
  engineer: "Precise, explains its evidence and calls out risks.",
  custom: "Describe the personality you want below.",
};
const normalizePersona = (persona: BotPersona): BotPersona => ({
  preset: persona.preset,
  style: persona.style,
  ...(persona.userName?.trim() ? { userName: persona.userName.trim() } : {}),
});
const EVENT_KINDS = [
  "completed",
  "failed",
  "approval",
  "question",
  "interrupted",
] as const;
const eventLabels: Record<(typeof EVENT_KINDS)[number], string> = {
  completed: "Completed",
  failed: "Failed",
  approval: "Approval needed",
  question: "Question pending",
  interrupted: "Interrupted",
};
const triggerLabels = {
  user: "Your messages",
  event: "Conversation events",
  schedule: "Scheduled checks",
};
const DEFAULT_WATCH_PROMPT =
  "Follow up on this activity according to the user’s goals. Stay quiet when nothing actionable changed.";
const DEFAULT_SCHEDULE_PROMPT =
  "Check unfinished tasks. Report only meaningful progress or something needing attention.";
const MAX_INTERVAL = 10080;
const INTERVAL_UNITS = [
  { minutes: 1, label: "Minutes" },
  { minutes: 60, label: "Hours" },
  { minutes: 1440, label: "Days" },
] as const;
const INTERVAL_PRESETS = [
  { minutes: 15, label: "15 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "1 day" },
];
/** Hosts can hold thousands of conversations; rows mount a page at a time. */
const WATCHED_PAGE = 50;

export type BotSessionOption = {
  id: string;
  harness?: RemoteProvider;
  title: string;
  projectId: string;
  /** Latest activity, used to list recent conversations first. */
  activityAt?: number | null;
};

function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return !!zone.trim();
  } catch {
    return false;
  }
}
function supportedTimeZones(): string[] | undefined {
  try {
    const values = (
      Intl as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    return values?.length ? values : undefined;
  } catch {
    return undefined;
  }
}
const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;
const unitFor = (minutes: number): number =>
  [...INTERVAL_UNITS].reverse().find((u) => minutes % u.minutes === 0)
    ?.minutes ?? 1;

function Section({
  title,
  hint,
  card = false,
  kind,
  children,
}: {
  title: string;
  hint?: string;
  card?: boolean;
  kind?: string;
  children: ReactNode;
}) {
  return (
    <section className={`assistant-settings-section${card ? " desktop-bot-setting-group" : ""}`} data-section={kind}>
      <header>
        <h3>{title}</h3>
      </header>
      {card ? <div className="desktop-bot-setting-card">{hint && <p>{hint}</p>}{children}</div> : <>{hint && <p>{hint}</p>}{children}</>}
    </section>
  );
}

function CollapsibleSection({
  title,
  summary,
  open,
  onToggle,
  dialog,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  dialog?: { onCancel: () => void; onApply: () => void; busy: boolean };
  /** A factory defers content until the section first opens. */
  children: ReactNode | (() => ReactNode);
}) {
  if (dialog) return <section className="assistant-settings-section" data-dialog="true">
    <BotSettingsDialog title={title} summary={summary ?? ""} open={open} onOpen={onToggle} {...dialog}>
      {typeof children === "function" ? open && children() : children}
    </BotSettingsDialog>
  </section>;
  return (
    <section className="assistant-settings-section" data-open={open}>
      <button
        type="button"
        className="assistant-settings-disclosure"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="assistant-settings-disclosure-title">{title}</span>
        {summary && (
          <small className="assistant-settings-summary">{summary}</small>
        )}
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <AnimatedCollapse expanded={open}>{children}</AnimatedCollapse>
    </section>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="assistant-settings-disclosure"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="assistant-settings-disclosure-title">{label}</span>
      <ChevronDown size={18} aria-hidden="true" />
    </button>
  );
}

/** Desktop uses the searchable picker; mobile keeps the native system picker. */
const SelectSlot = createContext<
  ComponentType<BotSelectProps> | undefined
>(undefined);

function Picker({
  mobile,
  compact = false,
  ...props
}: BotSelectProps & { mobile: boolean; compact?: boolean }) {
  const Custom = useContext(SelectSlot);
  const {
    label,
    value,
    options,
    onChange,
    placeholder,
    disabled,
    hideLabel = false,
    hint,
    searchable = options.length > 8,
  } = props;
  if (Custom) return <Custom {...props} />;
  if (!mobile)
    return (
      <div className="assistant-field assistant-picker">
        {!hideLabel && <span className="assistant-field-label">{label}</span>}
        <SearchableSelect
          variant={compact ? "pill" : "transparent"}
          className="assistant-picker-control"
          label={label}
          value={value}
          options={options}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          searchable={searchable}
        />
        {hint && <small>{hint}</small>}
      </div>
    );
  return (
    <label>
      {!hideLabel && label}
      <select data-ui="select"
        aria-label={hideLabel ? label : undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function BotSettings({
  value,
  catalog,
  catalogState = "ready",
  catalogError,
  onRetryCatalog,
  loadSessions,
  projects,
  busy,
  onSave,
  onCancel,
  onCancelReminder,
  reminders,
  memory,
  habits,
  im,
  personaSupported = true,
  autonomySupported = false,
  mobile = false,
  panel = "all",
  presentation,
  submitLabel,
  Select,
  MemoryDetail = BotMemoryDialog,
  Actions = Fragment,
}: {
  /** Live follow-ups; kept outside the draft so cancelling never resets edits. */
  reminders?: BotConfiguration["reminders"];
  /** Live habit editing; omitted on Hosts without habits. */
  habits?: {
    items: BotHabit[];
    timeZone: string;
    control: (input: HabitControl) => Promise<void>;
  };
  /** Live memory editing; omitted on Hosts without assistant memory. */
  memory?: { rpc: BotRpc; revision: number; lines: number };
  /** Host-owned live channel settings, outside the assistant configuration draft. */
  im?: { rpc: BotRpc; supported: boolean; active: boolean; assistantEnabled: boolean };
  /** Older Hosts reject personality and time zone fields. */
  personaSupported?: boolean;
  autonomySupported?: boolean;
  /** Cancels a follow-up the assistant promised; omitted on older Hosts. */
  onCancelReminder?: (reminderId: string) => Promise<void>;
  /** Platform picker; omitted on desktop, which uses the searchable select. */
  Select?: ComponentType<BotSelectProps>;
  /** Platform panel for one remembered fact; desktop uses a dialog. */
  MemoryDetail?: ComponentType<BotMemoryDetailProps>;
  Actions?: ComponentType<{ children: ReactNode }>;
  value: BotConfiguration | null;
  catalog: HostModelCatalog;
  catalogState?: "loading" | "ready" | "failed";
  catalogError?: string;
  onRetryCatalog?: () => void;
  loadSessions?: (projectIds: string[]) => Promise<BotSessionOption[]>;
  projects: HostProject[];
  busy: boolean;
  onSave: (patch: BotPatch) => Promise<void>;
  onCancel?: () => void;
  mobile?: boolean;
  /** Desktop detail tabs may split configuration; mobile retains the full form. */
  panel?: "all" | "settings" | "automation";
  presentation?: "inspector";
  submitLabel?: string;
}) {
  const { t } = useTranslation();
  const inspector = !mobile && presentation === "inspector";
  const section = mobile ? "all" : panel;
  const [initialDraft] = useState<BotPatch>(
    () =>
      value ?? {
        name: "Assistant",
        persona: defaultBotPersona(),
        harness: Object.keys(catalog.models)[0] as RemoteProvider,
        model: Object.values(catalog.models)[0]?.[0]?.id,
        policy: fullBotPolicy(),
        runtimeMode: "full-access",
        targetRuntimeMode: "full-access",
      },
  );
  const [draft, setDraft] = useState<BotPatch>(initialDraft);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const dialogDraft = useRef(draft);
  const cancelDialog = () => setDraft(dialogDraft.current);
  // Permissions and wakeups default sensibly, so they stay folded away.
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [sessionOptionsOpen, setSessionOptionsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [habitsOpen, setHabitsOpen] = useState(false);
  // Project filters apply to explicitly followed conversations.
  const [pickingProjects, setPickingProjects] = useState(
    () =>
      new Set(
        (value?.watches ?? [])
          .filter((watch) => watch.projectIds.length)
          .map((watch) => watch.id),
      ),
  );
  const form = useRef<HTMLFormElement>(null);
  // Fallbacks are fixed at mount so an untouched form compares as unchanged.
  const [defaults] = useState(() => ({
    schedule: {
      id: "hourly",
      enabled: true,
      intervalMinutes: 60,
      prompt: DEFAULT_SCHEDULE_PROMPT,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nextRunAt: Date.now() + 3600000,
    },
    watches: [
      {
        id: "activity",
        enabled: true,
        projectIds: [],
        sessionIds: [],
        eventKinds: [...EVENT_KINDS],
        prompt: DEFAULT_WATCH_PROMPT,
      },
    ] as BotConfiguration["watches"],
  }));
  useEffect(() => {
    if (!value && (!draft.harness || !draft.model)) {
      const harness = Object.keys(catalog.models).find(
        (h) => catalog.models[h as RemoteProvider]?.length,
      ) as RemoteProvider | undefined;
      if (harness)
        setDraft((d) => ({
          ...d,
          harness,
          model: catalog.models[harness]?.[0]?.id,
        }));
    }
  }, [catalog, value, draft.harness, draft.model]);
  const policy = draft.policy ?? fullBotPolicy();
  const triggers = draft.triggers ?? {
    user: true,
    event: true,
    schedule: true,
  };
  const schedule =
    draft.schedules?.[0] ?? value?.schedules[0] ?? defaults.schedule;
  const watches = draft.watches ?? value?.watches ?? defaults.watches;
  const persona = draft.persona ?? value?.persona ?? defaultBotPersona();
  const pendingReminders = (reminders ?? [])
    .filter((reminder) => reminder.state === "pending")
    .sort((a, b) => a.dueAt - b.dueAt);
  const patch = (next: BotPatch) => setDraft((d) => ({ ...d, ...next }));
  const patchWatch = (
    i: number,
    next: Partial<BotConfiguration["watches"][number]>,
  ) =>
    patch({
      watches: watches.map((w, index) => (index === i ? { ...w, ...next } : w)),
    });
  const toPatch = (source: BotPatch): BotPatch => {
    const {
      name,
      persona: sourcePersona,
      harness,
      model,
      modelSettings,
      runtimeMode,
      targetRuntimeMode,
      policy,
      triggers,
      schedules,
      watches: sourceWatches,
      maxAutoTurns,
      chainWindowMinutes,
      worktreeIdleMinutes,
    } = source;
    const sourceSchedules = schedules ?? [
      value?.schedules[0] ?? defaults.schedule,
    ];
    const result: BotPatch = {
      name: name?.trim(),
      ...(personaSupported
        ? {
            persona: normalizePersona(
              sourcePersona ?? value?.persona ?? defaultBotPersona(),
            ),
            // The assistant's sense of local time follows the schedule time zone.
            timezone: sourceSchedules[0]?.timezone,
          }
        : {}),
      harness,
      model,
      ...(modelSettings ? { modelSettings } : {}),
      runtimeMode,
      targetRuntimeMode,
      policy,
      triggers: triggers ?? { user: true, event: true, schedule: true },
      schedules: sourceSchedules,
      watches: sourceWatches ?? watches,
      ...(maxAutoTurns ? { maxAutoTurns } : {}),
      ...(chainWindowMinutes ? { chainWindowMinutes } : {}),
      ...(mobile && autonomySupported && worktreeIdleMinutes !== undefined ? { worktreeIdleMinutes } : {}),
    };
    if (section === "automation") return {
      triggers: result.triggers, schedules: result.schedules, watches: result.watches,
      timezone: result.timezone, maxAutoTurns: result.maxAutoTurns, chainWindowMinutes: result.chainWindowMinutes,
      ...(JSON.stringify(policy) !== JSON.stringify(value?.policy) ? { policy } : {}),
    };
    if (section === "settings") {
      const { triggers: _triggers, schedules: _schedules, watches: _watches, timezone: _timezone, maxAutoTurns: _max, chainWindowMinutes: _window, ...settings } = result;
      return settings;
    }
    return result;
  };
  const [initial] = useState(() => JSON.stringify(toPatch(draft)));
  const dirty = !value || JSON.stringify(toPatch(draft)) !== initial;
  const maxAutoTurns = draft.maxAutoTurns ?? 8;
  const chainWindow = draft.chainWindowMinutes ?? 15;
  const [intervalUnit, setIntervalUnit] = useState(() =>
    unitFor(schedule.intervalMinutes),
  );
  const intervalAmount = schedule.intervalMinutes / intervalUnit;
  const errors = {
    name: section !== "automation" && !draft.name?.trim() ? "Enter a name" : undefined,
    persona:
      section !== "automation" && personaSupported && persona.preset === "custom" && !persona.style.trim()
        ? "Describe the personality"
        : undefined,
    interval: section !== "settings" && !inRange(schedule.intervalMinutes, 1, MAX_INTERVAL)
      ? "Choose between 1 minute and 7 days"
      : undefined,
    timezone: section !== "settings" && !validTimeZone(schedule.timezone)
      ? "Unknown time zone"
      : undefined,
    maxAutoTurns: section !== "settings" && !inRange(maxAutoTurns, 1, 100) ? "Enter 1–100" : undefined,
    chainWindow: section !== "settings" && !inRange(chainWindow, 1, 1440)
      ? "Enter 1–1440 minutes"
      : undefined,
    worktreeIdle: mobile && autonomySupported && !inRange(draft.worktreeIdleMinutes ?? BOT_WORKTREE_IDLE_MINUTES, 0, 10080)
      ? "Enter 0–10080 minutes" : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const canSave = !busy && (section === "automation" || (!!draft.harness && !!draft.model)) && dirty;
  const allowed = BOT_PERMISSIONS.filter(
    (key) => policy.permissions[key],
  ).length;
  const setPermissions = (keys: BotPermission[], on: boolean) =>
    patch({
      policy: {
        ...policy,
        permissions: {
          ...policy.permissions,
          ...Object.fromEntries(keys.map((key) => [key, on])),
        },
      },
    });
  const setIntervalMinutes = (minutes: number) =>
    patch({
      schedules: [
        {
          ...schedule,
          intervalMinutes: minutes,
          nextRunAt: Date.now() + minutes * 60000,
        },
      ],
    });
  const revealErrors = () => {
    const advanced = !!(errors.maxAutoTurns || errors.chainWindow || errors.worktreeIdle);
    if (errors.interval || errors.timezone || advanced) {
      setEventsOpen(true);
    }
    if (advanced) setAdvancedOpen(true);
    // Collapsed content mounts on the next render; focus once it exists.
    setTimeout(() => {
      const field = form.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      );
      field?.focus({ preventScroll: true });
      field?.scrollIntoView?.({
        block: "center",
        behavior: reducedMotionQuery().matches ? "auto" : "smooth",
      });
    });
  };
  const fieldError = (message?: string) =>
    message && (
      <small className="assistant-field-error" role="alert">
        {t(message)}
      </small>
    );
  const harnesses = Object.keys(catalog.models) as RemoteProvider[];
  const models = draft.harness ? (catalog.models[draft.harness] ?? []) : [];
  const reasoning = draft.harness
    ? remoteModelControls(
        catalog,
        draft.harness,
        draft.model ?? "",
        draft.modelSettings ?? {},
        value?.harness === draft.harness ? value.model : undefined,
      ).settings.find((setting) => isEffortSettingId(setting.id))
    : undefined;
  const chooseModel = (harness: RemoteProvider, model?: string) => {
    const next = findRemoteModel(catalog.models[harness] ?? [], model ?? "");
    patch({
      harness,
      model,
      modelSettings: carryModelSettings(next?.settings ?? [], draft.modelSettings ?? {}),
    });
  };
  const harnessError = draft.harness
    ? catalog.errors[draft.harness]
    : undefined;
  const loadingCatalog = catalogState === "loading" && !harnesses.length;
  const zones = useMemo(() => {
    const list = supportedTimeZones();
    if (!list) return undefined;
    return list.includes(schedule.timezone) || !schedule.timezone
      ? list
      : [schedule.timezone, ...list];
  }, [schedule.timezone]);

  const modes = {
    runtimeMode: (draft.runtimeMode ?? "full-access") as RuntimeMode,
    targetRuntimeMode: (draft.targetRuntimeMode ??
      "full-access") as RuntimeMode,
  };
  const sameMode = modes.runtimeMode === modes.targetRuntimeMode;
  const permissionsSection = (
    <CollapsibleSection
      title={t("Assistant permissions")}
      summary={`${t("{allowed} of {total} allowed", {
        allowed,
        total: BOT_PERMISSIONS.length,
      })} · ${
        policy.allowedProjects === "all"
          ? t("All projects")
          : t("{count} projects", { count: policy.allowedProjects.length })
      }`}
      open={permissionsOpen}
      onToggle={() => {
        if (inspector) dialogDraft.current = draft;
        setPermissionsOpen((v) => !v);
      }}
      dialog={inspector ? {
        busy,
        onCancel: () => { cancelDialog(); setPermissionsOpen(false); },
        onApply: () => setPermissionsOpen(false),
      } : undefined}
    >
      <div className="assistant-settings-row">
        {(["runtimeMode", "targetRuntimeMode"] as const).map((key) => (
          <Picker
            key={key}
            mobile={mobile}
            label={t(
              key === "runtimeMode"
                ? "Assistant execution permissions"
                : "Delegated agent permissions",
            )}
            value={modes[key]}
            placeholder=""
            options={RUNTIME_MODES.map((option) => ({
              value: option,
              label: t(RUNTIME_MODE_LABEL[option]),
            }))}
            onChange={(mode) => patch({ [key]: mode })}
            hint={sameMode ? undefined : t(RUNTIME_MODE_HINT[modes[key]])}
          />
        ))}
      </div>
      {sameMode && (
        <small className="assistant-settings-hint">
          {t(RUNTIME_MODE_HINT[modes.runtimeMode])}
        </small>
      )}
      <small className="assistant-settings-hint">
        {t("These permissions control the assistant's OmniCode actions. Agent execution permissions control commands and file access through the selected provider.")}
      </small>
      <p>{t("Conversation actions apply only to followed conversations and conversations created by the assistant. Other conversations are read-only.")}</p>
      <div className="assistant-settings-group-list">
        {permissionGroups.map((group) => {
          const count = group.keys.filter(
            (key) => policy.permissions[key],
          ).length;
          const all = count === group.keys.length;
          if (mobile && group.label === "Conversations") return (
            <div className="assistant-settings-group" key={group.label}>
              <label className="assistant-settings-group-title">
                {t("Allow the assistant to work for me")}
                <Switch checked={count > 0} onCheckedChange={checked => setPermissions(group.keys, checked)} />
              </label>
              <button type="button" className="assistant-link-button" aria-expanded={sessionOptionsOpen} onClick={() => setSessionOptionsOpen(open => !open)}>{t("More options")}</button>
              <AnimatedCollapse expanded={sessionOptionsOpen}>
                <div className="assistant-check-grid">{group.keys.map(key => <label className="assistant-check" key={key}>
                  <input data-ui="checkbox" type="checkbox" checked={policy.permissions[key]} onChange={e => setPermissions([key], e.target.checked)} />
                  {t(key === "sessions.create" ? "Start work" : labels[key])}
                </label>)}</div>
              </AnimatedCollapse>
            </div>
          );
          return (
            <div className="assistant-settings-group" key={group.label}>
              <div className="assistant-settings-group-title">
                {t(group.label)}
                <small className="assistant-settings-group-count">
                  {count}/{group.keys.length}
                </small>
                <button
                  type="button"
                  className="assistant-link-button"
                  onClick={() => setPermissions(group.keys, !all)}
                >
                  {t(all ? "Clear" : "Select all")}
                </button>
              </div>
              <div className="assistant-check-grid">
                {group.keys.map((key) => (
                  <label className="assistant-check" key={key}>
                    <input data-ui="checkbox"
                      type="checkbox"
                      checked={policy.permissions[key]}
                      onChange={(e) => setPermissions([key], e.target.checked)}
                    />
                    {t(labels[key])}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <div className="assistant-settings-group">
          <div className="assistant-settings-group-title">
            {t("Project access")}
          </div>
          <label className="assistant-check">
            <input data-ui="checkbox"
              type="checkbox"
              checked={policy.allowedProjects === "all"}
              onChange={(e) =>
                patch({
                  policy: {
                    ...policy,
                    allowedProjects: e.target.checked ? "all" : [],
                  },
                })
              }
            />
            {t("All projects")}
          </label>
          <AnimatedCollapse expanded={policy.allowedProjects !== "all"}>
            <div className="assistant-chips">
              {projects.map((project) => {
                const current =
                  policy.allowedProjects === "all"
                    ? []
                    : policy.allowedProjects;
                return (
                  <label className="assistant-chip" key={project.id}>
                    <input data-ui="checkbox"
                      type="checkbox"
                      checked={current.includes(project.id)}
                      onChange={(e) =>
                        patch({
                          policy: {
                            ...policy,
                            allowedProjects: e.target.checked
                              ? [...current, project.id]
                              : current.filter((p) => p !== project.id),
                          },
                        })
                      }
                    />
                    <span>{project.name}</span>
                  </label>
                );
              })}
            </div>
          </AnimatedCollapse>
        </div>
      </div>
    </CollapsibleSection>
  );

  const wakeupsSection = (
    <CollapsibleSection
      title={t("Assistant wakeups")}
      summary={
        (["user", "event", "schedule"] as const)
          .filter((key) => triggers[key])
          .map((key) => t(triggerLabels[key]))
          .join(" · ") || t("Off")
      }
      open={eventsOpen}
      onToggle={() => setEventsOpen((v) => !v)}
    >
      <div className="assistant-settings-group-list">
        <div className="assistant-settings-group">
          {(["user", "event", "schedule"] as const).map((key) => (
            <label className="assistant-check" key={key}>
              <input data-ui="checkbox"
                type="checkbox"
                checked={triggers[key]}
                onChange={(e) =>
                  patch({
                    triggers: { ...triggers, [key]: e.target.checked },
                  })
                }
              />
              {t(triggerLabels[key])}
            </label>
          ))}
        </div>
        <AnimatedCollapse expanded={triggers.schedule}>
          <div className="assistant-settings-group">
            <div className="assistant-settings-group-title">
              {t("Scheduled checks")}
            </div>
            <div className="assistant-field">
              <span className="assistant-field-label">{t("Check every")}</span>
              <div className="assistant-chips" role="radiogroup">
                {INTERVAL_PRESETS.map((preset) => (
                  <label className="assistant-chip" key={preset.minutes}>
                    <input
                      type="radio"
                      name="assistant-interval-preset"
                      checked={schedule.intervalMinutes === preset.minutes}
                      onChange={() => {
                        setIntervalUnit(unitFor(preset.minutes));
                        setIntervalMinutes(preset.minutes);
                      }}
                    />
                    <span>{t(preset.label)}</span>
                  </label>
                ))}
              </div>
              <div className="assistant-interval">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  aria-label={t("Interval")}
                  value={Number.isFinite(intervalAmount) ? intervalAmount : ""}
                  aria-invalid={!!errors.interval || undefined}
                  onChange={(e) =>
                    setIntervalMinutes(Number(e.target.value) * intervalUnit)
                  }
                />
                <Picker
                  mobile={mobile}
                  hideLabel
                  label={t("Interval unit")}
                  placeholder=""
                  value={String(intervalUnit)}
                  options={INTERVAL_UNITS.map((unit) => ({
                    value: String(unit.minutes),
                    label: t(unit.label),
                  }))}
                  onChange={(next) => {
                    const unit = Number(next);
                    setIntervalUnit(unit);
                    setIntervalMinutes(
                      Math.max(1, Math.round(intervalAmount)) * unit,
                    );
                  }}
                />
              </div>
              {fieldError(errors.interval)}
            </div>
            {zones ? (
              <Picker
                mobile={mobile}
                searchable
                label={t("Time zone")}
                value={schedule.timezone}
                placeholder={t("Choose a time zone")}
                options={zones.map((zone) => ({
                  value: zone,
                  label: zone.replace(/_/g, " "),
                }))}
                onChange={(timezone) =>
                  patch({ schedules: [{ ...schedule, timezone }] })
                }
              />
            ) : (
              <label>
                {t("Time zone")}
                <Input
                  value={schedule.timezone}
                  aria-invalid={!!errors.timezone || undefined}
                  onChange={(e) =>
                    patch({
                      schedules: [{ ...schedule, timezone: e.target.value }],
                    })
                  }
                />
                {fieldError(errors.timezone)}
              </label>
            )}
            <label>
              {t("Scheduled check prompt")}
              <textarea data-ui="textarea"
                value={schedule.prompt}
                onChange={(e) =>
                  patch({
                    schedules: [{ ...schedule, prompt: e.target.value }],
                  })
                }
              />
            </label>
            {pendingReminders.length > 0 && (
              <div className="assistant-field">
                <span className="assistant-field-label">
                  {t("Promised follow-ups")}
                </span>
                <ul className="assistant-reminders">
                  {pendingReminders.map((reminder) => (
                    <li key={reminder.id}>
                      <time dateTime={new Date(reminder.dueAt).toISOString()}>
                        {new Date(reminder.dueAt).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </time>
                      <span title={reminder.prompt}>{reminder.prompt}</span>
                      {onCancelReminder && (
                        <button
                          type="button"
                          className="assistant-link-button"
                          disabled={busy}
                          onClick={() => void onCancelReminder(reminder.id)}
                        >
                          {t("Cancel")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </AnimatedCollapse>
        <AnimatedCollapse expanded={triggers.event}>
          {watches.map((watch, i) => (
            <div className="assistant-settings-group" key={watch.id}>
              <div className="assistant-settings-group-title">
                {t("Conversation events")}
              </div>
              <label className="assistant-check">
                <input data-ui="checkbox"
                  type="checkbox"
                  checked={watch.enabled}
                  onChange={(e) => patchWatch(i, { enabled: e.target.checked })}
                />
                {t("Follow these events")}
              </label>
              <div className="assistant-chips">
                {EVENT_KINDS.map((kind) => (
                  <label className="assistant-chip" key={kind}>
                    <input data-ui="checkbox"
                      type="checkbox"
                      checked={watch.eventKinds.includes(kind)}
                      onChange={(e) =>
                        patchWatch(i, {
                          eventKinds: e.target.checked
                            ? [...watch.eventKinds, kind]
                            : watch.eventKinds.filter((k) => k !== kind),
                        })
                      }
                    />
                    <span>{t(eventLabels[kind])}</span>
                  </label>
                ))}
              </div>
              <div className="assistant-field assistant-watch-projects">
                <span className="assistant-field-label">
                  {t("Watch projects")}
                </span>
                <label className="assistant-check">
                  <input data-ui="checkbox"
                    type="checkbox"
                    checked={!pickingProjects.has(watch.id)}
                    onChange={(e) => {
                      setPickingProjects((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.delete(watch.id);
                        else next.add(watch.id);
                        return next;
                      });
                      if (e.target.checked) patchWatch(i, { projectIds: [] });
                    }}
                  />
                  {t("All allowed projects")}
                </label>
                <AnimatedCollapse expanded={pickingProjects.has(watch.id)}>
                  <div className="assistant-chips">
                    {projects.map((project) => (
                      <label className="assistant-chip" key={project.id}>
                        <input data-ui="checkbox"
                          type="checkbox"
                          checked={watch.projectIds.includes(project.id)}
                          onChange={(e) =>
                            patchWatch(i, {
                              projectIds: e.target.checked
                                ? [...watch.projectIds, project.id]
                                : watch.projectIds.filter(
                                    (id) => id !== project.id,
                                  ),
                            })
                          }
                        />
                        <span>{project.name}</span>
                      </label>
                    ))}
                  </div>
                  <small>
                    {t("Project selection filters explicitly followed conversations")}
                  </small>
                </AnimatedCollapse>
              </div>
              <label>
                {t("Follow-up prompt")}
                <textarea data-ui="textarea"
                  value={watch.prompt}
                  onChange={(e) => patchWatch(i, { prompt: e.target.value })}
                />
              </label>
            </div>
          ))}
        </AnimatedCollapse>
        <Disclosure
          label={t("More options")}
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
        />
        <AnimatedCollapse expanded={advancedOpen}>
          <div className="assistant-settings-group">
            <div className="assistant-settings-row">
              <label>
                {t("Maximum automatic follow-ups")}
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={maxAutoTurns}
                  aria-invalid={!!errors.maxAutoTurns || undefined}
                  onChange={(e) =>
                    patch({ maxAutoTurns: Number(e.target.value) })
                  }
                />
                {fieldError(errors.maxAutoTurns)}
              </label>
              <label>
                {t("Follow-up window (minutes)")}
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={chainWindow}
                  aria-invalid={!!errors.chainWindow || undefined}
                  onChange={(e) =>
                    patch({ chainWindowMinutes: Number(e.target.value) })
                  }
                />
                {fieldError(errors.chainWindow)}
              </label>
            </div>
            {mobile && autonomySupported && <label>
              {t("Reclaim completed workspaces after (minutes)")}
              <Input type="number" min={0} max={10080} value={draft.worktreeIdleMinutes ?? BOT_WORKTREE_IDLE_MINUTES}
                aria-invalid={!!errors.worktreeIdle || undefined}
                onChange={event => patch({ worktreeIdleMinutes: Number(event.target.value) })} />
              {fieldError(errors.worktreeIdle)}
              <small>{t("Only clean, integrated workspaces are reclaimed. 0 keeps them indefinitely.")}</small>
            </label>}
            <WatchedSessions
              scopeOnly={mobile}
              active={advancedOpen}
              policy={policy}
              watches={watches}
              projectIds={projects.map((p) => p.id)}
              projects={projects}
              loadSessions={loadSessions}
              onRemove={(sessionId) => patch(removeWatchedSession(policy, watches, sessionId))}
              onFollowScope={(scope, sessions) => patch({
                policy: followSessionProjects(policy, scope, sessions),
                ...(scope === "all" || scope.length ? { triggers: { ...triggers, event: true } } : {}),
              })}
            />
          </div>
        </AnimatedCollapse>
      </div>
    </CollapsibleSection>
  );

  const identityFields = <>
      {!inspector && <label>
        {t("Assistant name")}
        <Input
          value={draft.name ?? ""}
          aria-invalid={!!errors.name || undefined}
          onChange={(e) => patch({ name: e.target.value })}
        />
        {fieldError(errors.name)}
      </label>}
      {personaSupported && (
        <>
          <label>
            {t("What should it call you?")}
            <Input
              value={persona.userName ?? ""}
              maxLength={100}
              onChange={(e) =>
                patch({
                  persona: { ...persona, userName: e.target.value },
                })
              }
            />
          </label>
          <div className="assistant-field">
            <span className="assistant-field-label">
              {t("Personality")}
            </span>
            <div
              className="assistant-chips"
              role="radiogroup"
              aria-label={t("Personality")}
            >
              {BOT_PERSONA_PRESETS.map((preset) => (
                <label className="assistant-chip" key={preset}>
                  <input
                    type="radio"
                    name="assistant-persona"
                    checked={persona.preset === preset}
                    onChange={() =>
                      patch({ persona: { ...persona, preset } })
                    }
                  />
                  <span>{t(personaLabels[preset])}</span>
                </label>
              ))}
            </div>
            <small>{t(personaHints[persona.preset])}</small>
          </div>
          <label>
            {t("Personality and tone")}
            <textarea data-ui="textarea"
              value={persona.style}
              maxLength={4000}
              aria-invalid={!!errors.persona || undefined}
              placeholder={t(
                "Optional, for example: speak Chinese, be a little humorous, keep replies under three sentences.",
              )}
              onChange={(e) =>
                patch({ persona: { ...persona, style: e.target.value } })
              }
            />
            {fieldError(errors.persona)}
          </label>
        </>
      )}
  </>;
  const identitySection = inspector && !personaSupported ? null : (
    <Section title={t(inspector ? "Instructions" : "Assistant")} card={inspector} kind="identity">
      {inspector ? <BotSettingsDialog title={t("Personality and tone")} summary={t(personaLabels[persona.preset])} preview={persona.style || t(personaHints[persona.preset])}
        size="sm" open={instructionsOpen} busy={busy} invalid={!!errors.persona}
        onOpen={() => { dialogDraft.current = draft; setInstructionsOpen(true); }}
        onCancel={() => { cancelDialog(); setInstructionsOpen(false); }}
        onApply={() => setInstructionsOpen(false)}>
        {identityFields}
      </BotSettingsDialog> : identityFields}
    </Section>
  );

  return (
    <SelectSlot.Provider value={Select}>
      <form
        ref={form}
        className="assistant-settings"
        noValidate
        data-layout={mobile ? "mobile" : "desktop"}
        data-presentation={inspector ? "inspector" : undefined}
        inert={inspector && (instructionsOpen || permissionsOpen)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          if (invalid) return revealErrors();
          void onSave(toPatch(draft));
        }}
      >
        <div className="assistant-settings-body">
          {section !== "automation" && <>{!inspector && identitySection}
          <Section title={t("Model")} card={inspector} kind="model">
            <div className="assistant-settings-row">
              <Picker
                mobile={mobile}
                compact={inspector}
                hideLabel={inspector}
                label={t("Agent")}
                value={draft.harness ?? ""}
                disabled={loadingCatalog || !harnesses.length}
                placeholder={t(
                  loadingCatalog ? "Loading models…" : "Choose an agent",
                )}
                options={harnesses.map((h) => ({
                  value: h,
                  label: HARNESS_TITLE[h] ?? h,
                  icon: <HarnessIcon harness={h} />,
                }))}
                onChange={(harness) =>
                  chooseModel(
                    harness as RemoteProvider,
                    catalog.models[harness as RemoteProvider]?.[0]?.id,
                  )
                }
              />
              <Picker
                mobile={mobile}
                compact={inspector}
                hideLabel={inspector}
                label={t("Model")}
                value={draft.model ?? ""}
                disabled={loadingCatalog || !models.length}
                placeholder={t(
                  loadingCatalog ? "Loading models…" : "Choose a model",
                )}
                options={models.map((m) => ({ value: m.id, label: m.name }))}
                onChange={(model) =>
                  draft.harness && chooseModel(draft.harness, model)
                }
              />
              <Picker
                mobile={mobile}
                compact={inspector}
                hideLabel={inspector}
                label={t("Reasoning effort")}
                value={
                  reasoning
                    ? (draft.modelSettings?.[reasoning.id] ?? reasoning.value)
                    : ""
                }
                disabled={busy || loadingCatalog || !reasoning?.options.length}
                placeholder={t(
                  loadingCatalog ? "Loading models…" : "Unavailable",
                )}
                options={
                  reasoning?.options.map((option) => ({
                    value: option.value,
                    label: t(option.label),
                  })) ?? []
                }
                onChange={(effort) =>
                  reasoning &&
                  patch({
                    modelSettings: {
                      ...draft.modelSettings,
                      [reasoning.id]: effort,
                    },
                  })
                }
              />
            </div>
            {catalogState === "failed" ? (
              <div className="assistant-field-notice" role="alert">
                <span>{t(catalogError ?? "Could not load models.")}</span>
                {onRetryCatalog && (
                  <button
                    type="button"
                    className="assistant-link-button"
                    onClick={onRetryCatalog}
                  >
                    {t("Retry")}
                  </button>
                )}
              </div>
            ) : catalogState === "ready" && !harnesses.length ? (
              <small className="assistant-field-error" role="status">
                {t("No agents are available on this Host.")}
              </small>
            ) : harnessError ? (
              <small className="assistant-field-error">{harnessError}</small>
            ) : null}
          </Section>
          {inspector && identitySection}
          {permissionsSection}</>}
          {section !== "settings" && wakeupsSection}
          {section !== "automation" && memory && (
            <CollapsibleSection
              title={t("Memory")}
              summary={t("{count} remembered facts", {
                count: memory.lines,
              })}
              open={memoryOpen}
              onToggle={() => setMemoryOpen((v) => !v)}
            >
              {() => (
                <BotMemoryEditor
                  rpc={memory.rpc}
                  revision={memory.revision}
                  disabled={busy}
                  Detail={MemoryDetail}
                />
              )}
            </CollapsibleSection>
          )}
          {section !== "settings" && habits && (
            <CollapsibleSection
              title={t("Habits")}
              summary={t("{count} habits", { count: habits.items.length })}
              open={habitsOpen}
              onToggle={() => setHabitsOpen((v) => !v)}
            >
              {() => (
                <BotHabits
                  habits={habits.items}
                  timeZone={habits.timeZone}
                  disabled={busy}
                  control={habits.control}
                />
              )}
            </CollapsibleSection>
          )}
          {section !== "automation" && im && !mobile && <BotImSettings {...im} disabled={busy} />}
        </div>
        <Actions>
          <footer className="assistant-settings-footer">
            {value && dirty && (
              <>
                <small className="assistant-settings-dirty" role="status">
                  {t("Unsaved changes")}
                </small>
                <Button variant="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(initialDraft);
                    setPickingProjects(
                      new Set(
                        value.watches
                          .filter((watch) => watch.projectIds.length)
                          .map((watch) => watch.id),
                      ),
                    );
                    setIntervalUnit(
                      unitFor(
                        (value.schedules[0] ?? defaults.schedule).intervalMinutes,
                      ),
                    );
                  }}
                >
                  {t("Reset")}
                </Button>
              </>
            )}
            {onCancel && (
              <Button variant="secondary" type="button" disabled={busy} onClick={onCancel}>
                {t("Cancel")}
              </Button>
            )}
            <Button variant="primary"
              type="submit"
              className="assistant-primary"
              disabled={!canSave}
            >
              {t(submitLabel ?? (value ? section === "automation" ? "Save automation" : "Save settings" : "Enable assistant"))}
            </Button>
          </footer>
        </Actions>
      </form>
    </SelectSlot.Provider>
  );
}

export function WatchedSessions({
  scopeOnly = false,
  active,
  policy,
  watches,
  projectIds,
  projects = [],
  loadSessions,
  onRemove,
  onFollowScope,
}: {
  scopeOnly?: boolean;
  active: boolean;
  policy: BotPolicy;
  watches: BotWatch[];
  projectIds: string[];
  projects?: (Pick<HostProject, "id" | "name"> & { cwd?: string })[];
  loadSessions?: (projectIds: string[]) => Promise<BotSessionOption[]>;
  onRemove: (sessionId: string) => void;
  onFollowScope?: (
    scope: "all" | string[],
    sessions: BotSessionOption[],
  ) => void;
}) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<BotSessionOption[]>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(WATCHED_PAGE);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const projectKey = projectIds.join("\n");
  useEffect(() => {
    if (!active || !loadSessions) return;
    let current = true;
    setSessions(undefined);
    setFailed(false);
    loadSessions(projectIds).then(
      (rows) => current && setSessions(rows),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [active, loadSessions, projectKey, retry]);
  const known = new Map((sessions ?? []).map((s) => [s.id, s]));
  // Retain unavailable explicit references so they can still be removed.
  for (const ref of policy.followedSessions ?? [])
    if (!known.has(ref.sessionId))
      known.set(ref.sessionId, {
        id: ref.sessionId,
        title: ref.sessionId,
        projectId: ref.projectId,
      });
  for (const watch of watches)
    for (const id of watch.sessionIds)
      if (watch.enabled && !known.has(id))
        known.set(id, { id, title: id, projectId: watch.projectIds[0] ?? "" });
  const options = [...known.values()]
    .filter((s) => isWatchedSession(policy, watches, s.projectId, s.id))
    .sort((a, b) => (b.activityAt ?? 0) - (a.activityAt ?? 0));
  const title = (session: BotSessionOption) =>
    session.harness
      ? sessionDisplayTitle(session.title, session.harness) ||
        t("Untitled conversation")
      : session.title;
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const projectName = (id: string) => projectNames.get(id);
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? options.filter((s) =>
        `${title(s)}\n${projectName(s.projectId) ?? ""}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : options;
  const visible = matches.slice(0, limit);
  // Project rows show their conversation count, most recently active first.
  const projectStats = new Map<string, { count: number; latest: number }>();
  for (const session of sessions ?? []) {
    const stat = projectStats.get(session.projectId) ?? { count: 0, latest: 0 };
    stat.count++;
    stat.latest = Math.max(stat.latest, session.activityAt ?? 0);
    projectStats.set(session.projectId, stat);
  }
  const projectNeedle = projectQuery.trim().toLocaleLowerCase();
  const pickerProjects = projects
    .filter(
      (project) =>
        !projectNeedle ||
        `${project.name}\n${project.cwd ?? ""}`
          .toLocaleLowerCase()
          .includes(projectNeedle),
    )
    .sort(
      (a, b) =>
        (projectStats.get(b.id)?.latest ?? 0) -
        (projectStats.get(a.id)?.latest ?? 0),
    );
  const allPickerSelected =
    pickerProjects.length > 0 &&
    pickerProjects.every((project) => selectedProjects.includes(project.id));
  // Rows name their project only when sessions can come from several.
  const showProjects = projects.length > 1;
  return (
    <div className="assistant-field assistant-watch">
      <div className="assistant-watch-header">
        <span className="assistant-field-label">
          {t(scopeOnly ? "Follow work by scope" : "Watched conversations")}
          {!scopeOnly && options.length > 0 && (
            <small className="assistant-settings-group-count">
              {options.length}
            </small>
          )}
        </span>
        {onFollowScope && (
          <div className="assistant-watch-bulk-actions">
            <button
              type="button"
              disabled={policy.followedProjects === "all"}
              onClick={() => onFollowScope("all", sessions ?? [])}
            >
              {t("Follow all conversations")}
            </button>
            <button
              type="button"
              disabled={!projects.length}
              aria-expanded={projectPickerOpen}
              onClick={() => {
                if (!projectPickerOpen)
                  setSelectedProjects(
                    policy.followedProjects === "all"
                      ? projects.map((p) => p.id)
                      : (policy.followedProjects ?? []),
                  );
                setProjectPickerOpen((open) => !open);
              }}
            >
              {t("Follow by project")}
            </button>
          </div>
        )}
      </div>
      {onFollowScope && (
        <>
          <AnimatedCollapse expanded={projectPickerOpen}>
            <div className="assistant-watch-project-picker">
              <div className="assistant-watch-project-toolbar">
                {projects.length > 10 && (
                  <Input
                    type="search"
                    aria-label={t("Search projects")}
                    placeholder={t("Search projects")}
                    value={projectQuery}
                    onChange={(e) => setProjectQuery(e.target.value)}
                  />
                )}
                <small>
                  {t("{count} selected", { count: selectedProjects.length })}
                </small>
                <button
                  type="button"
                  className="assistant-link-button"
                  disabled={!pickerProjects.length}
                  onClick={() => {
                    const ids = new Set(pickerProjects.map((p) => p.id));
                    setSelectedProjects((current) =>
                      allPickerSelected
                        ? current.filter((id) => !ids.has(id))
                        : [...new Set([...current, ...ids])],
                    );
                  }}
                >
                  {t(allPickerSelected ? "Clear" : "Select all")}
                </button>
              </div>
              <div
                className="assistant-watch-project-list"
                role="group"
                aria-label={t("Follow by project")}
              >
                {pickerProjects.map((project) => (
                  <label key={project.id} className="assistant-watch-project">
                    <input data-ui="checkbox"
                      type="checkbox"
                      checked={selectedProjects.includes(project.id)}
                      onChange={(event) =>
                        setSelectedProjects((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter((id) => id !== project.id),
                        )
                      }
                    />
                    <span className="assistant-watch-project-name">
                      <span>{project.name}</span>
                      {project.cwd && (
                        <small title={project.cwd}>{project.cwd}</small>
                      )}
                    </span>
                    {sessions && (
                      <small className="assistant-watch-project-count">
                        {projectStats.get(project.id)?.count ?? 0}
                      </small>
                    )}
                  </label>
                ))}
                {!pickerProjects.length && (
                  <small className="assistant-watch-project-empty">
                    {t("No matching projects")}
                  </small>
                )}
              </div>
              <button
                type="button"
                disabled={
                  !selectedProjects.length ||
                  failed ||
                  (!!loadSessions && !sessions)
                }
                onClick={() => {
                  onFollowScope(selectedProjects, sessions ?? []);
                  setProjectPickerOpen(false);
                }}
              >
                {t("Follow selected projects")}
              </button>
            </div>
          </AnimatedCollapse>
          {policy.followedProjects === "all" ||
          !!policy.followedProjects?.length ? (
            <div className="assistant-watch-scope">
              <small>
                {policy.followedProjects === "all"
                  ? t("Automatically following all conversations")
                  : t("Automatically following: {projects}", {
                      projects: policy
                        .followedProjects!.map((id) => projectName(id) ?? id)
                        .join(", "),
                    })}
              </small>
              <button
                type="button"
                className="assistant-link-button"
                onClick={() => onFollowScope([], sessions ?? [])}
              >
                {t("Remove scope follow")}
              </button>
            </div>
          ) : null}
        </>
      )}
      {!scopeOnly && <>
      {(options.length > 10 || query) && (
        <Input
          type="search"
          aria-label={t("Search conversations…")}
          placeholder={t("Search conversations…")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(WATCHED_PAGE);
          }}
        />
      )}
      {failed ? (
        <small role="alert">
          {t("Unable to load conversations.")}{" "}
          <button
            type="button"
            className="assistant-link-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            {t("Retry")}
          </button>
        </small>
      ) : loadSessions && sessions === undefined ? (
        <small>{t("Loading conversations…")}</small>
      ) : !options.length ? (
        <small>{t("No watched conversations.")}</small>
      ) : !matches.length ? (
        <small>{t("No matching conversations")}</small>
      ) : null}
      <div className="assistant-watched-sessions" hidden={!visible.length}>
        {visible.map((session) => (
          <div className="assistant-watched-session" key={session.id}>
            {session.harness && (
              <HarnessIcon
                harness={session.harness}
                className="size-4 shrink-0"
              />
            )}
            <span title={title(session)}>{title(session)}</span>
            {showProjects && projectName(session.projectId) && (
              <small className="assistant-watched-project">
                {projectName(session.projectId)}
              </small>
            )}
            {isExplicitlyWatchedSession(
              policy,
              session.projectId,
              session.id,
            ) && <small>{t("Configured permissions")}</small>}
            <button
              type="button"
              title={t("Remove")}
              aria-label={t("Remove {title} from watched conversations", {
                title: title(session),
              })}
              onClick={() => onRemove(session.id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        {matches.length > visible.length && (
          <button
            type="button"
            className="assistant-watched-more"
            onClick={() => setLimit((n) => n + WATCHED_PAGE)}
          >
            {t("Show more ({count} remaining)", {
              count: matches.length - visible.length,
            })}
          </button>
        )}
      </div>
      </>}
      <small className="assistant-watch-note">
        {onFollowScope &&
          `${t(
            "Scope follows include existing and future conversations. Individually removed conversations stay excluded.",
          )} `}
        {t(
          "Other conversations are read-only. Followed conversations use the permissions enabled in assistant settings. Assistant-created conversations are followed by default and remain manageable if removed.",
        )}
      </small>
    </div>
  );
}
