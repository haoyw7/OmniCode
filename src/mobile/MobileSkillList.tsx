import { Button } from "../shared/ui/forms/Button";
import { MobileSpinner } from "./MobileSpinner";
import { useEffect, useRef } from "react";
import type { Skill } from "../features/skills/model/skillTypes";
import { HARNESS_TITLE } from "../features/sessions/model/session";
import { Sparkles } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";

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
}) {
  const { t } = useTranslation();
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView?.({ block: "nearest" });
  }, [active, skills[active]?.invocation]);
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
      >
        {skills.map((skill, index) => (
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
            <span className="mobile-skill-origin">
              {skill.kind === "native"
                ? HARNESS_TITLE[skill.source]
                : skill.kind === "builtin"
                  ? "OmniCode"
                  : t(skill.scope === "project" ? "Project" : "Personal")}
            </span>
          </button>
        ))}
        {!skills.length && !loading && !failed && (
          <p className="mobile-skill-status" role="status">
            {t("No matching skills or commands")}
          </p>
        )}
      </div>
    </>
  );
}
