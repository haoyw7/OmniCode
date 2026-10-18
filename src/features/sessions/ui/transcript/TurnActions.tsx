import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { Check, FilePlusCorner, Pencil } from "../../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { playCue } from "../../../settings/model/sounds";




export function SaveNoteButton({
  text,
  onSave,
}: {
  text: string;
  onSave: (text: string) => void | Promise<void>;
}) {
  const { t: uiT } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setSaved(false);
    setError(null);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [text]);

  return (
    <>
      <button
        data-ui="response-action"
        type="button"
        disabled={pending}
        title={saved ? uiT("Saved to Notes") : uiT("Save as note")}
        aria-label={saved ? uiT("Saved to Notes") : uiT("Save as note")}
        className="rounded-md p-1 text-content/40 hover:bg-content/5 hover:text-content/70"
        onClick={async () => {
          setError(null);
          setSaved(false);
          setPending(true);
          try {
            await onSave(text);
            playCue("copy");
            setSaved(true);
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setSaved(false), 2000);
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        {saved ? (
          <Check className="size-3.5" />
        ) : (
          <FilePlusCorner className="size-3.5" />
        )}
      </button>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-content/70">
          {uiT("Could not save note. ")}
          {error}
        </span>
      )}
    </>
  );
}

export function EditLastTurnButton({
  onEdit,
  editing = false,
}: {
  onEdit: () => void;
  editing?: boolean;
}) {
  const label = editing ? "Cancel edit" : "Edit and resend";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={editing}
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
      className={`rounded-md p-1 transition-[background-color,color] duration-150 focus-visible:ring-1 focus-visible:ring-accent ${
        editing
          ? "edit-last-turn-button"
          : "text-content/40 hover:bg-content/5 hover:text-content/70"
      }`}
    >
      <Pencil className="size-3.5" />
    </button>
  );
}
