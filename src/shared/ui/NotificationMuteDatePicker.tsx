import { Button } from "./forms/Button";
import { useTranslation } from "../i18n/useTranslation";
import { useState } from "react";
import { DateTimePicker, parseLocalDateTime, toLocalDateTime } from "./DateTimePicker";

type Props = {
  initialUntil?: number | null;
  disabled?: boolean;
  onSave: (until: number) => void;
  onChanged?: () => void;
  onCancel: () => void;
};

/** Custom timing is a complete step, separate from the duration presets. */
export function NotificationMuteDatePicker({
  initialUntil,
  disabled = false,
  onSave,
  onChanged,
  onCancel,
}: Props) {
  const { t: uiT } = useTranslation();
  const [value, setValue] = useState(() => {
    const until = initialUntil;
    const initial =
      typeof until === "number" && until > Date.now()
        ? until
        : Date.now() + 3_600_000;
    return toLocalDateTime(new Date(Math.ceil(initial / 60_000) * 60_000));
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const date = parseLocalDateTime(value);
        if (!date) {
          setError("Choose a valid date and time.");
          return;
        }
        if (date.getTime() <= Date.now()) {
          setError("Choose a date and time in the future.");
          return;
        }
        try {
          onSave(date.getTime());
          setError(null);
          onChanged?.();
        } catch {
          setError(
            "Could not save notification preferences. Please try again.",
          );
        }
      }}
    >
      <p className="mb-3 px-1 text-[11px] text-content/45">
        {uiT("Mute all notifications until")}
      </p>
      <DateTimePicker
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
        minDate={toLocalDateTime(new Date(Date.now())).slice(0, 10)}
        autoFocus
      />
      {error ? (
        <p role="alert" className="mt-3 px-1 text-xs text-red-400">
          {uiT(error)}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-stroke pt-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1.5 text-xs text-content/50 hover:bg-content/3 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
        >
          {uiT("Cancel")}
        </button>
        <Button variant="primary"
          type="submit"
          disabled={disabled}
          className="flex shrink-0 items-center rounded-md border border-transparent px-2.5 py-1 text-[12px] focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default"
        >
          {uiT("Mute until then")}
        </Button>
      </div>
    </form>
  );
}
