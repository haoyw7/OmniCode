import { motion, useIsPresent } from "motion/react";
import {
  immediateTransition,
  motionDistance,
  panelTransition,
} from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Switch } from "../../../shared/ui/forms/Switch";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { playCue } from "../model/sounds";



export const settingDomId = (id: string) => `setting-${id}`;

/** The row or group Settings just jumped to, so it can flash where you landed. */
export const RevealedSetting = createContext<string | null>(null);

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="pb-6">
      <h1 data-settings-title className="text-ui-xl font-semibold leading-tight text-foreground">
        {title}
      </h1>
      {description ? (
        <p className="mt-1.5 max-w-xl text-ui-base leading-6 text-foreground-subtle">
          {description}
        </p>
      ) : null}
    </header>
  );
}

/**
 * A titled card of related settings. Everything on a page lives in one, so a
 * page reads as a handful of topics instead of one long list of switches.
 */
export const SettingsPage = forwardRef<HTMLDivElement, { children: ReactNode; reduced: boolean }>(function SettingsPage({ children, reduced }, ref) {
  const present = useIsPresent();
  return <motion.div ref={ref} data-settings-page inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0, y: motionDistance.pop }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
    transition={reduced ? immediateTransition : panelTransition}
  ><SurfaceVisibilityContext.Provider value={present}>{children}</SurfaceVisibilityContext.Provider></motion.div>;
});

export function Group({
  id,
  title,
  description,
  action,
  children,
}: {
  /** Matches a `SETTINGS_INDEX` id when the whole card is the search target. */
  id?: string;
  /** Untitled groups render as a bare ZCode settings card. */
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const reduced = useMotionPreference();
  const revealed = useContext(RevealedSetting);
  const flash = id != null && revealed === id;

  return (
    <section
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-revealed={flash || undefined}
      data-settings-group
      className={title || description || action ? "pt-8 first:pt-0" : "pt-5 first:pt-0"}
    >
      {title || description || action ? (
        <div className="flex items-end gap-4 pb-3">
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 data-settings-group-title className="text-ui-lg font-semibold text-foreground">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0 pb-0.5">{action}</div> : null}
        </div>
      ) : null}
      <motion.div
        initial={false}
        animate={{ borderColor: flash ? "color-mix(in srgb, var(--color-accent) 60%, transparent)" : "var(--color-border)" }}
        transition={reduced ? immediateTransition : panelTransition}
        className={`settings-card overflow-hidden rounded-xl border ${
          flash ? "border-accent/60" : "border-border"
        }`}
      >
        {children}
      </motion.div>
    </section>
  );
}

export function Row({
  id,
  label,
  description,
  stacked = false,
  children,
}: {
  /** Matches a `SETTINGS_INDEX` id so search can scroll here. */
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  /** Full-width control under the label (pickers, grids). */
  stacked?: boolean;
  children?: ReactNode;
}) {
  const revealed = useContext(RevealedSetting);
  const flash = id != null && revealed === id;

  return (
    <div
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-stacked={stacked || undefined}
      data-revealed={flash || undefined}
      className={`settings-row flex ${stacked ? "flex-col items-stretch gap-3" : "items-center gap-6"} border-t border-border px-4 py-3 first:border-t-0 ${
        flash ? "bg-accent/10" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="settings-row-label text-ui-base font-medium text-foreground">{label}</div>
        {description ? (
          <p className="settings-row-description mt-0.5 text-ui-caption leading-5 text-foreground-subtle">
            {description}
          </p>
        ) : null}
      </div>
      {stacked ? (
        children
      ) : (
        <div className="settings-row-control flex min-w-0 max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  optionIdPrefix,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  optionIdPrefix?: string;
}) {
  const indicatorId = useId();
  const reduced = useMotionPreference();
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // Keep the selection metadata available to skins while Motion moves the fill.
  const travel = useRef({ index, direction: undefined as "forward" | "back" | undefined });
  if (travel.current.index !== index) {
    travel.current = {
      index,
      direction: index > travel.current.index ? "forward" : "back",
    };
  }
  const direction = travel.current.direction;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-settings-segmented
      data-direction={direction}
      className="inline-grid max-w-full shrink-0 gap-1 text-ui-base"
      style={
        {
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
          "--segment-count": options.length,
          "--segment-index": index,
        } as CSSProperties
      }
    >
      {options.map((option) => (
        <button
          id={
            optionIdPrefix
              ? `${optionIdPrefix}-${option.value.toLowerCase()}`
              : undefined
          }
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`relative isolate h-7 min-w-0 truncate rounded-full px-3 font-medium transition-colors ${
            value === option.value
              ? "text-foreground"
              : "text-foreground-subtle hover:bg-surface-hover hover:text-foreground"
          }`}
        >
          {value === option.value ? <motion.span layoutId={indicatorId} transition={reduced ? immediateTransition : panelTransition} data-segment-indicator aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-selection" style={{ width: "auto", inset: 0 }} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A drag held still this long previews its value; release applies it at once. */
const PREVIEW_IDLE_MS = 1000;

/**
 * Applies after the thumb rests for a second, or on release. Root-level
 * appearance variables restyle the whole window, so applying while the thumb
 * moves makes the drag stutter. Release saves once: each save is a
 * shared-preference write that re-applies every appearance setting and syncs
 * to the Host.
 */
export function LiveSlider({
  label,
  value,
  format,
  min,
  max,
  preview,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  min: number;
  max: number;
  /** Applies a draft without saving it. */
  preview: (value: number) => void;
  /** Applies and saves the released value. */
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const latest = useRef({ value, draft, preview, onChange });
  latest.current = { value, draft, preview, onChange };
  const timer = useRef<number | undefined>(undefined);

  const cancelPreview = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const commit = (next: number) => {
    cancelPreview();
    if (next !== latest.current.value) latest.current.onChange(next);
    else latest.current.preview(next);
  };

  // Leaving the page mid-drag must not strand a previewed, unsaved value.
  useEffect(
    () => () => {
      cancelPreview();
      const { value, draft, onChange } = latest.current;
      if (draft !== value) onChange(draft);
    },
    [],
  );

  return (
    <Slider
      label={label}
      value={draft}
      display={format(draft)}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(next) => {
        setDraft(next);
        cancelPreview();
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          latest.current.preview(next);
        }, PREVIEW_IDLE_MS);
      }}
      onCommit={commit}
    />
  );
}

export function Slider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Fires once a drag or key press ends, for settings costly to apply live. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
}) {
  const commit = (event: { currentTarget: HTMLInputElement }) =>
    onCommit?.(Number(event.currentTarget.value));
  return (
    <div
      className={`flex w-60 max-w-full items-center gap-4 ${disabled ? "opacity-40" : ""}`}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        disabled={disabled}
        className="settings-slider min-w-0 flex-1 disabled:cursor-not-allowed"
        style={
          {
            "--slider-fill": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%`,
          } as CSSProperties
        }
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="w-10 shrink-0 text-right text-ui-base text-foreground tabular-nums">
        {display}
      </span>
    </div>
  );
}

export function Toggle({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      aria-label={label}
      checked={on}
      disabled={disabled}
      onCheckedChange={(next) => {
        onChange(next);
        playCue("switch");
      }}
    />
  );
}
