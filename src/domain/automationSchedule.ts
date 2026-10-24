import type { Automation, AutomationDraft, AutomationTrigger, AutomationTriggerKind, AutomationScheduleKind } from "../contracts/automations";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function isScheduleKind(value: string): value is AutomationScheduleKind {
  return (
    value === "hourly" ||
    value === "daily" ||
    value === "weekdays" ||
    value === "weekly"
  );
}

export function createAutomationTrigger(
  kind: AutomationTriggerKind,
  event: string,
  extras: Partial<AutomationTrigger> = {},
): AutomationTrigger {
  return {
    id: extras.id ?? crypto.randomUUID(),
    kind,
    event,
    scheduleKind:
      extras.scheduleKind ??
      (kind === "time" && isScheduleKind(event) ? event : "weekdays"),
    minute: extras.minute ?? 0,
    time: extras.time ?? "09:00",
    dayOfWeek: extras.dayOfWeek ?? 1,
    repos: extras.repos ?? [],
    repo: extras.repo ?? "",
    branch: extras.branch ?? "",
    actor: extras.actor ?? "anyone",
  };
}

export function automationTriggers(
  automation: Pick<
    Automation,
    | "id"
    | "triggers"
    | "triggerKind"
    | "triggerEvent"
    | "scheduleKind"
    | "minute"
    | "time"
    | "dayOfWeek"
  >,
): AutomationTrigger[] {
  if (automation.triggers) return automation.triggers;
  return [
    createAutomationTrigger(
      automation.triggerKind,
      automation.triggerEvent || automation.scheduleKind,
      {
        id: `${automation.id}:legacy`,
        scheduleKind: automation.scheduleKind,
        minute: automation.minute,
        time: automation.time,
        dayOfWeek: automation.dayOfWeek,
      },
    ),
  ];
}

export function applyTriggers(
  draft: AutomationDraft,
  triggers: AutomationTrigger[],
): AutomationDraft {
  const primary =
    triggers.find((trigger) => trigger.kind === "time") ?? triggers[0];
  return {
    ...draft,
    triggers,
    triggerKind: primary?.kind ?? "time",
    triggerEvent: primary?.event ?? "",
    scheduleKind: primary?.scheduleKind ?? "weekdays",
    minute: primary?.minute ?? 0,
    time: primary?.time ?? "09:00",
    dayOfWeek: primary?.dayOfWeek ?? 1,
  };
}

export function nextTriggersRunAt(
  triggers: readonly AutomationTrigger[],
  after = Date.now(),
): number {
  const times = triggers.filter((trigger) => trigger.kind === "time");
  if (times.length === 0) return after + YEAR_MS;
  return Math.min(
    ...times.map((trigger) => nextAutomationRunAt(trigger, after)),
  );
}

export function overdueTriggerOccurrences(
  triggers: readonly AutomationTrigger[],
  firstRunAt: number,
  now: number,
  limit = 100,
): Array<{ scheduledFor: number; nextRunAt: number }> {
  const occurrences: Array<{ scheduledFor: number; nextRunAt: number }> = [];
  let scheduledFor = firstRunAt;
  while (scheduledFor <= now && occurrences.length < limit) {
    const nextRunAt = nextTriggersRunAt(triggers, scheduledFor);
    if (nextRunAt <= scheduledFor) break;
    occurrences.push({ scheduledFor, nextRunAt });
    scheduledFor = nextRunAt;
  }
  return occurrences;
}

export function nextAutomationRunAt(
  schedule: Pick<
    AutomationDraft,
    "scheduleKind" | "minute" | "time" | "dayOfWeek"
  >,
  after = Date.now(),
): number {
  const start = new Date(after);
  start.setSeconds(0, 0);
  const [hour, minute] = parseTime(schedule.time);
  if (schedule.scheduleKind === "hourly") {
    const candidate = new Date(start);
    candidate.setMinutes(clamp(schedule.minute, 0, 59), 0, 0);
    if (candidate.getTime() <= after)
      candidate.setHours(candidate.getHours() + 1);
    return candidate.getTime();
  }

  const candidate = new Date(start);
  candidate.setHours(hour, minute, 0, 0);
  if (schedule.scheduleKind === "daily") {
    if (candidate.getTime() <= after)
      candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  if (schedule.scheduleKind === "weekdays") {
    if (candidate.getTime() <= after)
      candidate.setDate(candidate.getDate() + 1);
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  const day = clamp(schedule.dayOfWeek, 0, 6);
  let days = (day - candidate.getDay() + 7) % 7;
  if (days === 0 && candidate.getTime() <= after) days = 7;
  candidate.setDate(candidate.getDate() + days);
  return candidate.getTime();
}

function parseTime(value: string): [number, number] {
  const [hour, minute] = value.split(":").map(Number);
  return [clamp(hour, 0, 23), clamp(minute, 0, 59)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
