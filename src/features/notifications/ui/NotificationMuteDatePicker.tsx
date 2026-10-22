import { Button } from "../../../shared/ui/forms/Button";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FieldError } from "../../../shared/ui/primitives/Field";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import {
  DateTimePicker,
  parseLocalDateTime,
  toLocalDateTime,
} from "../../../shared/ui/DateTimePicker";

type Props = {
  projectIds: readonly string[];
  onChanged?: () => void;
  onCancel: () => void;
};

/** Custom timing is a complete step, separate from the duration presets. */
export function NotificationMuteDatePicker({
  projectIds,
  onChanged,
  onCancel,
}: Props) {
  const { t: uiT } = useTranslation();
  const initialValue = () => {
    const until =
      projectIds.length === 1
        ? loadNotificationPreferences()[projectIds[0]]?.mutedUntil
        : undefined;
    const initial =
      typeof until === "number" && until > Date.now()
        ? until
        : Date.now() + 3_600_000;
    return toLocalDateTime(new Date(Math.ceil(initial / 60_000) * 60_000));
  };
  const form = useForm({
    resolver: zodResolver(z.object({ value: z.string().superRefine((value, ctx) => {
      const date = parseLocalDateTime(value);
      if (!date) ctx.addIssue({ code: "custom", message: uiT("Choose a valid date and time.") });
      else if (date.getTime() <= Date.now()) ctx.addIssue({ code: "custom", message: uiT("Choose a date and time in the future.") });
    }) })),
    defaultValues: { value: initialValue() },
  });
  const value = useWatch({ control: form.control, name: "value" });
  return (
    <form
      noValidate
      className="w-full"
      onSubmit={form.handleSubmit(({ value }) => {
        if (!projectIds.length) return;
        try {
          updateNotificationPreferences(projectIds, { mutedUntil: parseLocalDateTime(value)!.getTime() });
          onChanged?.();
        } catch {
          const message = uiT("Could not save notification preferences. Please try again.");
          form.setError("value", { type: "server", message });
          toast.error(message);
        }
      })}
    >
      <p className="mb-3 px-1 text-[11px] text-content/45">
        {uiT("Mute all notifications until")}
      </p>
      <DateTimePicker
        invalid={!!form.formState.errors.value}
        value={value}
        onChange={(next) => {
          form.setValue("value", next, { shouldValidate: true });
        }}
        minDate={toLocalDateTime(new Date(Date.now())).slice(0, 10)}
        autoFocus
      />
      <FieldError errors={[form.formState.errors.value]} />
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-stroke pt-2.5">
        <Button variant="ghost" size="sm"
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1.5 text-xs text-content/50 hover:bg-content/3 hover:text-content"
        >
          {uiT("Cancel")}
        </Button>
        <Button variant="primary"
          type="submit"
          disabled={!projectIds.length || form.formState.isSubmitting}
          className="flex shrink-0 items-center rounded-md border border-transparent px-2.5 py-1 text-[12px] disabled:cursor-default"
        >
          {uiT("Mute until then")}
        </Button>
      </div>
    </form>
  );
}
