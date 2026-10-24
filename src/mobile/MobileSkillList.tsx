import type { Skill } from "../contracts/skills";
import { Button } from "../shared/ui/forms/Button";
import { MobileSpinner } from "./MobileSpinner";
import { useEffect, useRef, type ReactNode } from "react";

import { HARNESS_TITLE } from "../contracts/session";
import { Sparkles } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";

/** Sections follow the ranked order: built-in, agent or project, then personal. */
function skillGroup(skill: Skill) {
  if (skill.kind === "native") return { key: `native:${skill.source}`, label: HARNESS_TITLE[skill.source], translate: false };
  if (skill.kind === "builtin") return { key: "builtin", label: "Built-in", translate: true };
  return skill.scope === "project"
    ? { key: "project", label: "Project", translate: true }
    : { key: "user", label: "Personal", translate: true };
}

export function MobileSkillList({
  skills,
  loading,
  failed,
  error,
  active,
  id,
  onPick,
  onActive,
  onRetry,
  grouped = false,
}: {
  skills: Skill[];
  loading: boolean;
  failed: boolean;
  error?: string;
  active: number;
  id: string;
  onPick: (skill: Skill) => void;
  onActive: (index: number) => void;
  onRetry: () => void;
  /** Sheet presentation: labelled sections replace the per-row origin. */
  grouped?: boolean;
}) {
  const { t } = useTranslation();
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView?.({ block: "nearest" });
  }, [active, skills[active]?.invocation]);
  const rows = skills.map((skill, index) => (
    <button
      key={`${skill.kind}:${skill.invocation}`}
      type="button"
      ref={index === active ? selected : undefined}
      id={`${id}-${index}`}
      role="option"
      aria-selected={index === active}
      className="mobile-sheet-row"
      onPointerDown={(event) => event.preventDefault()}
      onMouseEnter={() => onActive(index)}
      onClick={() => onPick(skill)}
    >
      <Sparkles size={20} />
      <span className="mobile-sheet-row-text">
        <strong>/{skill.invocation}</strong>
        {skill.description && (
          <small className="mobile-skill-description">
            {skill.kind === "builtin"
              ? t(skill.description)
              : skill.description}
          </small>
        )}
        {skill.kind === "native" && skill.inputHint && (
          <small className="mobile-skill-input-hint">
            {skill.inputHint}
          </small>
        )}
      </span>
      {!grouped && (
        <span className="mobile-skill-origin">
          {skill.kind === "native"
            ? HARNESS_TITLE[skill.source]
            : skill.kind === "builtin"
              ? "OmniCode"
              : t(skill.scope === "project" ? "Project" : "Personal")}
        </span>
      )}
    </button>
  ));
  const groups: (ReturnType<typeof skillGroup> & { rows: ReactNode[] })[] = [];
  if (grouped) skills.forEach((skill, index) => {
    const group = skillGroup(skill);
    const existing = groups.find(item => item.key === group.key);
    if (existing) existing.rows.push(rows[index]);
    else groups.push({ ...group, rows: [rows[index]] });
  });
  return (
    <>
      {loading && (
        <p className="mobile-skill-status" role="status">
          <MobileSpinner className="mobile-spin" size={16} />
          {t("Loading skills and commands…")}
        </p>
      )}
      {failed && (
        <div className="mobile-skill-error">
          <p className="mobile-form-error" role="alert">
            {t("Could not load skills and commands.")}
            {error ? ` ${error}` : ""}
          </p>
          <Button variant="secondary" type="button" onClick={onRetry}>
            {t("Retry")}
          </Button>
        </div>
      )}
      <div
        className="mobile-skill-options"
        role="listbox"
        id={id}
        aria-label={t("Skills and commands")}
        data-grouped={grouped || undefined}
      >
        {grouped ? groups.map((group, groupIndex) => (
          <div key={group.key} className="mobile-skill-group" role="group" aria-labelledby={`${id}-group-${groupIndex}`}>
            <h3 id={`${id}-group-${groupIndex}`}>{group.translate ? t(group.label) : group.label}</h3>
            <div className="mobile-skill-cards">{group.rows}</div>
          </div>
        )) : rows}
        {!skills.length && !loading && !failed && (
          <p className="mobile-skill-status" role="status">
            {t("No matching skills or commands")}
          </p>
        )}
      </div>
    </>
  );
}
