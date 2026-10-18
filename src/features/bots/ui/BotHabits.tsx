import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import type {
  BotHabit,
  BotHabitKind,
  BotHabitSchedule,
} from "../model/botHabits";

export type HabitControl =
  | {
      action: "createHabit";
      habit: { name: string; prompt: string; schedule: BotHabitSchedule };
    }
  | {
      action: "updateHabit";
      habitId: string;
      habit: Partial<{
        name: string;
        prompt: string;
        schedule: BotHabitSchedule;
        enabled: boolean;
      }>;
    }
  | { action: "deleteHabit" | "runHabit"; habitId: string };

const KINDS: { kind: BotHabitKind; label: string }[] = [
  { kind: "hourly", label: "Hourly" },
  { kind: "daily", label: "Daily" },
  { kind: "weekdays", label: "Weekdays" },
  { kind: "weekly", label: "Weekly" },
];
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const OUTCOMES = {
  posted: "Last run reported to you",
  quiet: "Last run had nothing to report",
  failed: "Last run failed",
} as const;

type Draft = {
  /** The habit being edited; absent while adding one. */
  id?: string;
  name: string;
  prompt: string;
  schedule: BotHabitSchedule;
};
const newDraft = (): Draft => ({
  name: "",
  prompt: "",
  schedule: { scheduleKind: "weekdays", minute: 0, time: "09:00", dayOfWeek: 1 },
});

/**
 * Calendar habits, kept by the Host and run in the assistant's time zone.
 * Changes apply at once, like cancelling a reminder, and never touch the
 * settings draft.
 */
export function BotHabits({
  habits,
  timeZone,
  disabled,
  control,
}: {
  habits: BotHabit[];
  timeZone: string;
  disabled?: boolean;
  /** Sends one change and refreshes the view; rejects with the Host's error. */
  control: (input: HabitControl) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>();
  // The editor keeps its last contents while it folds away.
  const [shown, setShown] = useState<Draft>(newDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const busy = disabled || pending;
  const run = async (input: HabitControl) => {
    setPending(true);
    setError(undefined);
    try {
      await control(input);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setPending(false);
    }
  };
  const open = (next: Draft) => {
    setShown(next);
    setDraft(next);
  };
  const edit = (next: Partial<Draft>) => {
    const value = { ...shown, ...next };
    setShown(value);
    setDraft(value);
  };
  const editSchedule = (next: Partial<BotHabitSchedule>) =>
    edit({ schedule: { ...shown.schedule, ...next } });
  const label = (schedule: BotHabitSchedule) => {
    if (schedule.scheduleKind === "hourly")
      return t("Hourly at :{minute}", {
        minute: String(schedule.minute).padStart(2, "0"),
      });
    if (schedule.scheduleKind === "daily")
      return t("Daily at {time}", { time: schedule.time });
    if (schedule.scheduleKind === "weekdays")
      return t("Weekdays at {time}", { time: schedule.time });
    return t("{day} at {time}", {
      day: t(WEEKDAYS[schedule.dayOfWeek]),
      time: schedule.time,
    });
  };
  const when = (at: number) => {
    const options: Intl.DateTimeFormatOptions = {
      dateStyle: "medium",
      timeStyle: "short",
    };
    try {
      return new Date(at).toLocaleString(undefined, { ...options, timeZone });
    } catch {
      return new Date(at).toLocaleString(undefined, options);
    }
  };
  // The editor sits inside the settings form; Enter must not submit it.
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void save();
  };
  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.prompt.trim()) return;
    const habit = {
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      schedule: draft.schedule,
    };
    if (
      await run(
        draft.id
          ? { action: "updateHabit", habitId: draft.id, habit }
          : { action: "createHabit", habit },
      )
    )
      setDraft(undefined);
  };
  return (
    <div className="assistant-habits">
      {!habits.length && (
        <p className="assistant-habits-empty">
          {t("No habits yet. Ask the assistant to do something regularly, or add one here.")}
        </p>
      )}
      {habits.length > 0 && (
        <ul className="assistant-habit-list" aria-label={t("Habits")}>
          {habits.map((habit) => (
            <li key={habit.id} data-paused={!habit.enabled || undefined}>
              <div className="assistant-habit-summary">
                <strong>{habit.name}</strong>
                <small>
                  {label(habit.schedule)}
                  {" · "}
                  {habit.enabled
                    ? t("Next run {time}", { time: when(habit.nextRunAt) })
                    : t("Paused")}
                </small>
                {habit.lastOutcome && (
                  <small data-outcome={habit.lastOutcome}>
                    {t(OUTCOMES[habit.lastOutcome])}
                  </small>
                )}
              </div>
              <div className="assistant-habit-actions">
                <button
                  type="button"
                  className="assistant-link-button"
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "runHabit", habitId: habit.id })
                  }
                >
                  {t("Run now")}
                </button>
                <button
                  type="button"
                  className="assistant-link-button"
                  disabled={busy}
                  onClick={() =>
                    void run({
                      action: "updateHabit",
                      habitId: habit.id,
                      habit: { enabled: !habit.enabled },
                    })
                  }
                >
                  {t(habit.enabled ? "Pause" : "Resume")}
                </button>
                <button
                  type="button"
                  className="assistant-link-button"
                  disabled={busy}
                  onClick={() =>
                    open({
                      id: habit.id,
                      name: habit.name,
                      prompt: habit.prompt,
                      schedule: habit.schedule,
                    })
                  }
                >
                  {t("Edit")}
                </button>
                <button
                  type="button"
                  className="assistant-link-button"
                  disabled={busy}
                  onClick={() => {
                    if (draft?.id === habit.id) setDraft(undefined);
                    void run({ action: "deleteHabit", habitId: habit.id });
                  }}
                >
                  {t("Delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AnimatedCollapse expanded={!draft}>
        <button data-ui="button" data-variant="secondary"
          type="button"
          className="assistant-habit-add"
          disabled={busy || !!draft}
          onClick={() => open(newDraft())}
        >
          {t("Add habit")}
        </button>
      </AnimatedCollapse>
      <AnimatedCollapse expanded={!!draft}>
        <div className="assistant-habit-editor" inert={!draft}>
          <label>
            {t("Name")}
            <input data-ui="input"
              value={shown.name}
              maxLength={80}
              disabled={busy}
              onChange={(e) => edit({ name: e.target.value })}
              onKeyDown={onEnter}
            />
          </label>
          <label>
            {t("What to do")}
            <textarea data-ui="textarea"
              value={shown.prompt}
              maxLength={4000}
              disabled={busy}
              placeholder={t("What to check, and when it is worth telling you")}
              onChange={(e) => edit({ prompt: e.target.value })}
            />
          </label>
          <div className="assistant-field">
            <span className="assistant-field-label">{t("Repeat")}</span>
            <div className="assistant-chips" role="radiogroup">
              {KINDS.map(({ kind, label }) => (
                <label className="assistant-chip" key={kind}>
                  <input
                    type="radio"
                    name="assistant-habit-kind"
                    checked={shown.schedule.scheduleKind === kind}
                    disabled={busy}
                    onChange={() => editSchedule({ scheduleKind: kind })}
                  />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </div>
          {shown.schedule.scheduleKind === "weekly" && (
            <div className="assistant-field">
              <span className="assistant-field-label">{t("Day")}</span>
              <div className="assistant-chips" role="radiogroup">
                {WEEKDAYS.map((day, index) => (
                  <label className="assistant-chip" key={day}>
                    <input
                      type="radio"
                      name="assistant-habit-day"
                      checked={shown.schedule.dayOfWeek === index}
                      disabled={busy}
                      onChange={() => editSchedule({ dayOfWeek: index })}
                    />
                    <span>{t(day)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {shown.schedule.scheduleKind === "hourly" ? (
            <label>
              {t("Minute")}
              <input data-ui="input"
                type="number"
                min={0}
                max={59}
                step={1}
                value={shown.schedule.minute}
                onKeyDown={onEnter}
                disabled={busy}
                onChange={(e) =>
                  editSchedule({
                    minute: Math.min(59, Math.max(0, Math.round(Number(e.target.value) || 0))),
                  })
                }
              />
            </label>
          ) : (
            <label>
              {t("Time")}
              <input data-ui="input"
                type="time"
                value={shown.schedule.time}
                onKeyDown={onEnter}
                disabled={busy}
                onChange={(e) =>
                  e.target.value && editSchedule({ time: e.target.value })
                }
              />
            </label>
          )}
          <small>{t("Times are in {zone}.", { zone: timeZone })}</small>
          <div className="assistant-habit-editor-actions">
            <button data-ui="button" data-variant="secondary"
              type="button"
              disabled={pending}
              onClick={() => setDraft(undefined)}
            >
              {t("Cancel")}
            </button>
            <button data-ui="button" data-variant="primary"
              type="button"
              className="assistant-primary"
              disabled={busy || !shown.name.trim() || !shown.prompt.trim()}
              onClick={() => void save()}
            >
              {t(shown.id ? "Save habit" : "Add habit")}
            </button>
          </div>
        </div>
      </AnimatedCollapse>
      {error && (
        <small className="assistant-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
