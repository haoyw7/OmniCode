import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ArrowUp, CircleStop, CornerDownLeft } from "../../../shared/ui/icons";
import { type ReactNode } from "react";

export function ToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      aria-expanded={active}
      aria-haspopup="menu"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`composer-plus grid size-6.5 shrink-0 place-items-center rounded-md ${
        active
          ? "bg-selection-emphasis text-content"
          : "bg-selection text-content/50 hover:bg-selection-hover hover:text-content"
      } disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content/50`}
    >
      {children}
    </button>
  );
}

export function ComposerAction({
  busy,
  disabled = false,
  hasValue,
  allowBusySubmit = true,
  label = "Send",
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled?: boolean;
  hasValue: boolean;
  allowBusySubmit?: boolean;
  label?: string;
  onSend: () => void;
  onStop: () => void;
}) {
  const { t: uiT } = useTranslation();
  const sendIcon = <><ArrowUp className="composer-send-arrow size-3.5" strokeWidth={2.25} /><CornerDownLeft className="composer-send-return hidden size-3.5" strokeWidth={1.5} /></>;
  if (disabled) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled
        className="composer-send primary-action grid size-6.5 place-items-center rounded-md disabled:cursor-default"
      >
        {sendIcon}
      </button>
    );
  }
  if (busy) {
    return hasValue && allowBusySubmit ? (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onSend}
        className="composer-send primary-action grid size-6.5 place-items-center rounded-md"
      >
        {sendIcon}
      </button>
    ) : (
      <button
        type="button"
        title={uiT("Stop")}
        aria-label={uiT("Stop")}
        onClick={onStop}
        className="composer-stop grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90"
      >
        <CircleStop className="size-4 [&_rect]:fill-current" />
      </button>
    );
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={!hasValue}
      onClick={onSend}
      className="composer-send primary-action grid size-6.5 place-items-center rounded-md disabled:cursor-default"
    >
      {sendIcon}
    </button>
  );
}
