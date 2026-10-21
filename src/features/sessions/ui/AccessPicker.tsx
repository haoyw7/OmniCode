import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { MenuPanel } from "../../../shared/ui/primitives/MenuPanel";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronDown } from "../../../shared/ui/icons";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { RuntimeModeIcon } from "./RuntimeModeIcon";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../model/session";

type Props = {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  onClose?: () => void;
  busy?: boolean;
  appearance?: "composer";
};

const MENU_WIDTH = 288;

export function AccessPicker({
  value,
  onChange,
  onClose,
  busy = false,
  appearance,
}: Props) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(0, RUNTIME_MODES.indexOf(value)),
  );
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, RUNTIME_MODES.indexOf(value)));
  }, [open, value]);

  const pick = (mode: RuntimeMode) => {
    onChange(mode);
    dismiss(true);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(RUNTIME_MODES.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const mode = RUNTIME_MODES[active];
      if (mode) pick(mode);
    }
  };

  return (
    <div ref={root} className="relative">
      <Button variant="ghost" size="content"
        type="button"
        data-access-picker-trigger
        title={`${uiT(RUNTIME_MODE_HINT[value])}${busy ? uiT(" Changes apply to the next turn.") : ""}`}
        aria-label={uiT(RUNTIME_MODE_LABEL[value])}
        aria-expanded={open}
        aria-haspopup="listbox"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        className={cn("flex h-6.5 max-w-52 items-center gap-1 rounded-md px-1.5", open
            ? "bg-selection text-content"
            : "bg-selection text-content hover:bg-selection-hover")}
      >
        <RuntimeModeIcon
          mode={value}
          className={cn("size-3.5 shrink-0", value === "full-access" ? "text-warning/90" : "")}
        />
        <span className="min-w-0 truncate text-[11px]">
          {uiT(RUNTIME_MODE_LABEL[value])}
        </span>
        <ChevronDown
          className={cn("size-3 shrink-0 text-content/50", open ? "rotate-180" : "")}
        />
      </Button>
      <MenuPanel
        appearance={appearance}
        open={open}
        inset={appearance === "composer"}
        anchor={root}
        side="top"
        width={MENU_WIDTH}
        autoFocus
        onDismiss={(reason) => dismiss(reason === "escape")}
        role="listbox"
        aria-label={uiT("Access")}
        data-access-picker
        tabIndex={-1}
        onKeyDown={onMenuKey}
        className="p-1"
      >
        {RUNTIME_MODES.map((mode, index) => {
          const selected = mode === value;
          const highlighted = index === active;
          return (
            <Button variant="ghost" size="content"
              key={mode}
              type="button"
              role="option"
              aria-selected={selected}
              data-menu-row={appearance === "composer" ? "single" : "description"}
              data-highlighted={highlighted || selected || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(mode)}
              className={cn("relative isolate flex w-full items-start gap-2.5 rounded-lg text-left justify-start", highlighted || selected
                  ? "bg-selection text-content"
                  : "text-content hover:bg-content/3")}
            >
              <MenuHover />
              <RuntimeModeIcon
                mode={mode}
                className={cn("mt-0.5 size-3.5 shrink-0", mode === "full-access" ? "text-warning/90" : "text-content/70")}
              />
              <span className="min-w-0">
                <span data-menu-title className={cn("block text-[13px] leading-5", appearance === "composer" ? "font-normal" : "font-medium")}>
                  {uiT(RUNTIME_MODE_LABEL[mode])}
                </span>
                {appearance !== "composer" ? (
                  <span data-menu-description className="mt-0.5 block text-[11px] leading-4 text-content/50">
                    {uiT(RUNTIME_MODE_HINT[mode])}
                  </span>
                ) : null}
              </span>
            </Button>
          );
        })}
        {busy ? (
          <p data-menu-explanation className="px-2 py-1.5 text-[11px] leading-4 text-content/50">
            {uiT(
              "Access changes apply to the next turn. Stop and resend to apply them now.",
            )}
          </p>
        ) : null}
      </MenuPanel>
    </div>
  );
}
