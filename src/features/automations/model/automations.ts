import type { Automation, AutomationDraft, AutomationRun, AutomationUpsert, AutomationTriggerKind, AutomationScheduleKind } from "../../../contracts/automations";
import { applyTriggers, automationTriggers, createAutomationTrigger, nextTriggersRunAt } from "../../../domain/automationSchedule";
import { automationHostRequest } from "./automationHost";
import { translate } from "../../../shared/i18n/language";
import type { HarnessId } from "../../../contracts/session";

export const AUTOMATIONS_CHANGED = "omnicode:automations-changed";
const LOCAL_CHANGED = "omnicode:automations-local-changed";

export function formatAutomationRunAt(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "—";
  const date = new Date(at);
  const month = date.toLocaleDateString(undefined, { month: "short" });
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.getDate()} ${month}, ${time}`;
}

export function formatAutomationRunDuration(
  run: Pick<
    AutomationRun,
    "status" | "createdAt" | "startedAt" | "completedAt"
  >,
  now = Date.now(),
): string {
  const live = run.status === "pending" || run.status === "running";
  const start =
    run.startedAt ?? (run.status === "pending" ? undefined : run.createdAt);
  const end = run.completedAt ?? (live && start ? now : undefined);
  if (!start || end == null || end < start) return "—";
  const minutes = Math.floor((end - start) / 60_000);
  if (minutes < 1) return "< 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export const AUTOMATION_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function gmtOffsetLabel(date = new Date()): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return rest === 0
    ? `GMT${sign}${hours}`
    : `GMT${sign}${hours}:${String(rest).padStart(2, "0")}`;
}

export function nextRunPreview(at: number): string {
  const date = new Date(at);
  const day = date
    .toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(/,/g, "");
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const zone =
    new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ??
    gmtOffsetLabel(date);
  return `Next run ${day}, ${time} ${zone}`;
}

export function automationScheduleLabel(
  automation: Pick<
    Automation,
    "scheduleKind" | "minute" | "time" | "dayOfWeek"
  >,
): string {
  const time = formatClock(automation.time);
  if (automation.scheduleKind === "hourly") {
    return translate("Hourly at :{minute}", {
      minute: String(automation.minute).padStart(2, "0"),
    });
  }
  if (automation.scheduleKind === "daily")
    return translate("Daily at {time}", { time });
  if (automation.scheduleKind === "weekdays")
    return translate("Weekdays at {time}", { time });
  return translate("{day} at {time}", {
    day: translate(AUTOMATION_WEEKDAYS[automation.dayOfWeek] ?? "Weekly"),
    time,
  });
}

export function newAutomationDraft(
  cwd: string,
  harness: HarnessId,
  model: string,
): AutomationDraft {
  return {
    name: "",
    prompt: "",
    harness,
    model,
    modelSettings: {},
    cwd,
    workspaceMode: "worktree",
    executionCwd: "",
    sessionFolderId: "",
    reuseSession: false,
    runtimeMode: "auto",
    triggerKind: "time",
    triggerEvent: "",
    scheduleKind: "weekdays",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    triggers: [],
    missedRunGraceMinutes: 720,
    enabled: true,
  };
}

export function draftFromTemplate(
  cwd: string,
  harness: HarnessId,
  model: string,
  template: {
    name: string;
    prompt: string;
    trigger: {
      kind: AutomationTriggerKind;
      event: string;
      scheduleKind?: AutomationScheduleKind;
      time?: string;
      dayOfWeek?: number;
      minute?: number;
    };
  },
): AutomationDraft {
  const draft = newAutomationDraft(cwd, harness, model);
  const trigger = createAutomationTrigger(
    template.trigger.kind,
    template.trigger.event,
    {
      scheduleKind: template.trigger.scheduleKind,
      time: template.trigger.time,
      dayOfWeek: template.trigger.dayOfWeek,
      minute: template.trigger.minute,
    },
  );
  return applyTriggers(
    {
      ...draft,
      name: template.name,
      prompt: template.prompt,
    },
    [trigger],
  );
}

export function draftFromAutomation(automation: Automation): AutomationDraft {
  return {
    id: automation.id,
    name: automation.name,
    prompt: automation.prompt,
    harness: automation.harness,
    model: automation.model,
    modelSettings: automation.modelSettings ?? {},
    cwd: automation.cwd,
    workspaceMode: automation.workspaceMode,
    executionCwd: automation.executionCwd ?? "",
    sessionFolderId: automation.sessionFolderId ?? "",
    reuseSession: automation.reuseSession,
    runtimeMode: automation.runtimeMode,
    triggerKind: automation.triggerKind,
    triggerEvent: automation.triggerEvent,
    scheduleKind: automation.scheduleKind,
    minute: automation.minute,
    time: automation.time,
    dayOfWeek: automation.dayOfWeek,
    triggers: automationTriggers(automation),
    missedRunGraceMinutes: automation.missedRunGraceMinutes,
    enabled: automation.enabled,
  };
}

let cachedAutomations: Automation[] | null = null;

/** Last successful list, for an immediate first render while refreshing. */
export function peekAutomations(): Automation[] | null {
  return cachedAutomations;
}

export async function listAutomations(): Promise<Automation[]> {
  const next = await automationHostRequest<Automation[]>("automations.list");
  cachedAutomations = next;
  return next;
}

export async function saveAutomation(
  draft: AutomationDraft,
): Promise<Automation> {
  const synced = applyTriggers(draft, draft.triggers);
  const automation: AutomationUpsert = {
    ...synced,
    id: synced.id ?? crypto.randomUUID(),
    nextRunAt: nextTriggersRunAt(synced.triggers),
  };
  const saved = await automationHostRequest<Automation>("automations.upsert", { automation });
  emitLocalChange();
  return saved;
}

export async function setAutomationEnabled(
  automation: Automation,
  enabled: boolean,
): Promise<Automation> {
  return saveAutomation({ ...draftFromAutomation(automation), enabled });
}

export async function deleteAutomation(id: string): Promise<void> {
  await automationHostRequest("automations.delete", { id });
  emitLocalChange();
}

export function listAutomationRuns(
  automationId: string,
): Promise<AutomationRun[]> {
  return automationHostRequest("automations.runs", { automationId });
}

export async function createManualAutomationRun(automationId: string): Promise<AutomationRun> {
  const run = await automationHostRequest<AutomationRun>("automations.run", { automationId });
  emitLocalChange();
  return run;
}

export function notifyAutomationsChanged() {
  emitLocalChange();
}

export function subscribeAutomations(onChange: () => void): () => void {
  const onLocal = () => onChange();
  window.addEventListener(LOCAL_CHANGED, onLocal);
  // The Host scheduler keeps running while every desktop window is closed.
  const refresh = () => { cachedAutomations = null; onChange(); };
  const timer = window.setInterval(refresh, 5_000);
  window.addEventListener("focus", refresh);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener(LOCAL_CHANGED, onLocal);
  };
}

function emitLocalChange() {
  cachedAutomations = null;
  window.dispatchEvent(new Event(LOCAL_CHANGED));
}

function parseTime(value: string): [number, number] {
  const [hour, minute] = value.split(":").map(Number);
  return [clamp(hour, 0, 23), clamp(minute, 0, 59)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function formatClock(value: string): string {
  const [hour, minute] = parseTime(value);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
