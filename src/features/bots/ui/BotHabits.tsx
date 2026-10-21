import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { withToast } from "../../../shared/ui/primitives/Sonner";
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
  const [editing, setEditing] = useState(false);
  const schema = z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1, t("Enter a name")).max(80, t("Use at most {count} characters", { count: 80 })),
    prompt: z.string().trim().min(1, t("This field is required")).max(4000, t("Use at most {count} characters", { count: 4000 })),
    schedule: z.object({
      scheduleKind: z.enum(["hourly", "daily", "weekdays", "weekly"]),
      minute: z.number().int().min(0).max(59),
      time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, t("Choose a valid date and time.")),
      dayOfWeek: z.number().int().min(0).max(6),
    }),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: newDraft() });
  const shown = useWatch({ control: form.control }) as Draft;
  const draft = editing ? shown : undefined;
  const mutation = useMutation({ mutationFn: (input: HabitControl) => withToast(() => control(input),
    { loading: t("Saving…"), success: false }) }, queryClient);
  const pending = mutation.isPending;
  const error = mutation.error ? String(mutation.error instanceof Error ? mutation.error.message : mutation.error) : undefined;
  const busy = disabled || pending;
  const run = async (input: HabitControl) => {
    try {
      await mutation.mutateAsync(input);
      return true;
    } catch {
      return false;
    }
  };
  const open = (next: Draft) => {
    form.reset(next);
    setEditing(true);
  };
  const edit = (next: Partial<Draft>) => {
    for (const key of Object.keys(next) as (keyof Draft)[]) form.setValue(key, next[key]!, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
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
  const save = form.handleSubmit(async (draft) => {
    if (!editing || busy) return;
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
      setEditing(false);
  });
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
                    if (draft?.id === habit.id) setEditing(false);
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
              aria-invalid={!!form.formState.errors.name}
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
              aria-invalid={!!form.formState.errors.prompt}
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
                aria-invalid={!!form.formState.errors.schedule?.time}
                onKeyDown={onEnter}
                disabled={busy}
                onChange={(e) =>
                  e.target.value && editSchedule({ time: e.target.value })
                }
              />
            </label>
          )}
          <FieldError errors={[form.formState.errors.name, form.formState.errors.prompt, form.formState.errors.schedule?.time]} />
          <small>{t("Times are in {zone}.", { zone: timeZone })}</small>
          <div className="assistant-habit-editor-actions">
            <button data-ui="button" data-variant="secondary"
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
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
