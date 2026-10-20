import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Radio } from "../../../shared/ui/forms/Radio";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import { Omi } from "../../../shared/ui/branding/Omi";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { avatarExpressions, avatarShapes, avatarTones, avatarVariants, type BotAvatarAppearance } from "./botAvatarAppearance";

const labels = {
  original: "Original", circle: "Circle", triangle: "Triangle", square: "Square",
  ready: "Ready", curious: "Curious", focused: "Focused", joyful: "Joyful",
  encouraging: "Encouraging", sleepy: "Sleepy", inspired: "Inspired", surprised: "Surprised",
  outline: "Outline", filled: "Filled",
  violet: "Violet", blue: "Blue", teal: "Teal", amber: "Amber", rose: "Rose", green: "Green",
} as const;
const groups = [
  { key: "tone", label: "Color", options: avatarTones },
  { key: "shape", label: "Shape", options: avatarShapes },
  { key: "expression", label: "Expression", options: avatarExpressions },
  { key: "variant", label: "Fill style", options: avatarVariants },
] as const;

export function BotAvatarPicker({ value, disabled, onChange }: {
  value: BotAvatarAppearance; disabled: boolean; onChange: (value: BotAvatarAppearance) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return <div className="desktop-bot-avatar-picker">
    {groups.map(group => <fieldset key={group.key} disabled={disabled} className="desktop-bot-avatar-options" data-part={group.key}>
      <OptionRow legend={t(group.label)}>
        {group.options.map(option => {
          const appearance = { ...value, [group.key]: option };
          return <label key={option} className="desktop-bot-avatar-option" title={t(labels[option])}>
            <Radio name={`${id}-${group.key}`} value={option} checked={value[group.key] === option} aria-label={t(labels[option])} onChange={() => onChange(appearance)} />
            <span className="desktop-bot-avatar-option-content" style={{ color: `var(--color-omi-${appearance.tone}, currentColor)` }}>
              {group.key === "tone" ? <span className="desktop-bot-avatar-swatch" /> : <Omi compact expression={appearance.expression} shape={appearance.shape} variant={appearance.variant} width={48} height={48} aria-hidden="true" focusable="false" />}
            </span>
          </label>;
        })}
      </OptionRow>
    </fieldset>)}
  </div>;
}

/** One group of choices that scrolls sideways, paged by its previous and next buttons. */
function OptionRow({ legend, children }: { legend: string; children: ReactNode }) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const node = track.current;
    if (!node) return;
    const start = node.scrollLeft <= 1, end = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
    setEdges(current => current.start === start && current.end === end ? current : { start, end });
  }, []);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);
  const page = (direction: 1 | -1) => track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.8, behavior: reducedMotionQuery().matches ? "auto" : "smooth" });
  return <>
    <legend className="sr-only">{legend}</legend>
    <div className="desktop-bot-avatar-options-header">
      <span aria-hidden="true">{legend}</span>
      <span>
        <IconButton size="sm" tooltip={false} label={t("Previous")} disabled={edges.start} onClick={() => page(-1)}><ChevronLeft size={16} /></IconButton>
        <IconButton size="sm" tooltip={false} label={t("Next")} disabled={edges.end} onClick={() => page(1)}><ChevronRight size={16} /></IconButton>
      </span>
    </div>
    <div ref={track} className="desktop-bot-avatar-option-grid" onScroll={measure}>{children}</div>
  </>;
}
