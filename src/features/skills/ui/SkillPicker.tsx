import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { Input } from "../../../shared/ui/forms/Input";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Plus } from "../../../shared/ui/icons";
import {
  useEffect,
  useRef,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isLocalProject } from "../../projects/model/recents";
import { isValidSkillName, slugSkillName, type Skill } from "../model/skills";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";

type Props = {
  skills: Skill[];
  query: string;
  active: number;
  creating: boolean;
  cwd: string;
  compact?: boolean;
  showCreate?: boolean;
  error?: string | null;
  busy?: boolean;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
};

export function SkillPicker({
  skills,
  query,
  active,
  creating,
  cwd,
  compact = false,
  showCreate = true,
  error,
  busy,
  onActive,
  onPick,
  onStartCreate,
  onCancelCreate,
  onCreate,
}: Props) {
  const { t: uiT } = useTranslation();
  return (
    <div
      data-skill-picker
      className={
        compact
          ? "overflow-hidden"
          : "popover-backdrop overflow-hidden rounded-lg border border-content/10 backdrop-blur-xl"
      }
    >
      {creating ? (
        <CreateSkillForm
          query={query}
          cwd={cwd}
          error={error}
          busy={busy}
          onCancel={onCancelCreate}
          onCreate={onCreate}
        />
      ) : (
        <>
          <SkillList
            skills={skills}
            query={query}
            active={active}
            compact={compact}
            onActive={onActive}
            onPick={onPick}
          />
          {showCreate ? (
            <Button variant="ghost" size="content"
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onStartCreate}
              className="flex w-full items-center justify-start gap-2 border-t border-stroke px-2.5 py-2 text-left text-[12px] text-content/70 hover:bg-content/6 hover:text-content"
            >
              <Plus className="size-3.5 shrink-0" />
              {uiT("New skill")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function SkillList({
  skills,
  query,
  active,
  compact,
  onActive,
  onPick,
}: {
  skills: Skill[];
  query: string;
  active: number;
  compact?: boolean;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
}) {
  const { t: uiT } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [skills]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  if (skills.length === 0) {
    return (
      <p className="px-3 py-2.5 text-[12px] text-content/50">
        {query.trim()
          ? uiT("No matching commands or skills")
          : uiT("No commands yet")}
      </p>
    );
  }

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label={uiT("Commands and skills")}
      onMouseMove={onListMouseMove}
      className={cn(compact ? "max-h-48" : "max-h-[min(240px,40vh)]", "overflow-y-auto overscroll-none px-1 py-1")}
    >
      {skills.map((skill, index) => {
        const highlighted = index === active;
        return (
          <Button variant="ghost" size="content"
            key={`${skill.kind}:${skill.source}:${skill.invocation}`}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            data-menu-row={compact ? "" : "description"}
            aria-selected={highlighted}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onRowEnter(index)}
            onClick={() => onPick(skill)}
            className={cn("flex w-full justify-start text-left", compact ? "items-center" : "flex-col items-stretch", highlighted && "bg-selection")}
          >
            <span className="flex min-w-0 w-full items-baseline gap-2">
              <span className="truncate text-[13px]">/{skill.invocation}</span>
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-content/40">
                {scopeLabel(skill)}
              </span>
            </span>
            {!compact && skill.description ? (
              <span className="line-clamp-2 text-[11px] leading-4 text-content/50">
                {skill.description}
              </span>
            ) : null}
            {!compact &&
            skill.kind === "native" &&
            (skill.inputHint || skill.subcommands?.length) ? (
              <span className="line-clamp-2 text-[11px] text-content/40">
                {skill.inputHint ||
                  skill.subcommands
                    ?.map((sub) => sub.usage || sub.name)
                    .join(" · ")}
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

/** Shared starter-skill form for the composer picker and Settings. */
export function CreateSkillForm({
  query,
  cwd,
  monospace = true,
  error,
  busy,
  onCancel,
  onCreate,
}: {
  query: string;
  cwd: string;
  monospace?: boolean;
  error?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
}): ReactNode {
  const { t: uiT } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const project = isLocalProject(cwd);
  const schema = z.object({
    name: z.string().transform(slugSkillName).refine(isValidSkillName, uiT("Use lowercase letters, numbers, and hyphens.")),
    scope: z.enum(["project", "user"]),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { name: slugSkillName(query), scope: project ? "project" as const : "user" as const },
  });
  const [name, scope] = useWatch({ control: form.control, name: ["name", "scope"] });

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const valid = schema.safeParse({ name, scope }).success;

  const submit = form.handleSubmit(({ name, scope }) => {
    if (busy) return;
    onCreate(name, project ? scope : "user");
  });

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onCancel();
      }}
      className="px-2.5 py-2"
    >
      <p className="mb-2 text-[11px] text-content/50">
        {uiT("Writes a starter SKILL.md you can edit.")}
      </p>
      <Input
        {...form.register("name")}
        ref={(node) => { form.register("name").ref(node); input.current = node; }}
        aria-invalid={!!form.formState.errors.name}
        spellCheck={false}
        placeholder="skill-name"
        aria-label={uiT("Skill name")}
        disabled={busy}
        className={cn("mb-2", monospace ? "font-mono" : "font-sans")}
      />
      <div className="mb-2 flex gap-1">
        <ScopeButton
          label={uiT("Project")}
          hint=".agents/skills"
          monospace={monospace}
          selected={scope === "project"}
          disabled={!project || busy}
          onClick={() => form.setValue("scope", "project")}
        />
        <ScopeButton
          label={uiT("Personal")}
          hint="~/.agents/skills"
          monospace={monospace}
          selected={scope === "user"}
          disabled={busy}
          onClick={() => form.setValue("scope", "user")}
        />
      </div>
      <FieldError errors={[form.formState.errors.name, error ? { message: error } : undefined]} />
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="sm"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          {uiT("Cancel")}
        </Button>
        <Button variant="primary" size="sm"
          type="submit"
          disabled={!valid || busy}
        >
          {busy ? uiT("Creating…") : uiT("Create")}
        </Button>
      </div>
    </form>
  );
}

function ScopeButton({
  label,
  hint,
  monospace,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  monospace: boolean;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="content"
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className="flex min-w-0 flex-1 flex-col items-stretch rounded-md px-2 py-1.5 text-left"
    >
      <span className="text-[12px]">{label}</span>
      <span
        className={cn("truncate text-[10px] text-content/40", monospace ? "font-mono" : "font-sans")}
      >
        {hint}
      </span>
    </Button>
  );
}

function scopeLabel(skill: Skill): string {
  if (skill.kind === "native") {
    return skill.origin ? `${skill.source} · ${skill.origin}` : skill.source;
  }
  if (skill.kind === "builtin") return "omnicode";
  if (skill.scope === "user") return "personal";
  if (skill.source !== "agents" && skill.source !== "omnicode")
    return skill.source;
  return "project";
}
