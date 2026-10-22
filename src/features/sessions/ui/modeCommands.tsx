import { cn } from "../../../shared/lib/cn";
import { Button } from "../../../shared/ui/forms/Button";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  AiIdea,
  CircleDashed,
  CursorMagicSelection,
  MessageSquare,
  Share,
  X,
} from "../../../shared/ui/icons";
import { BTW_COMMAND } from "../model/btw";
import { DRAFT_COMMAND } from "../model/draftCommand";
import { OPERATOR_COMMAND } from "../model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { PLAN_COMMAND } from "../model/plan";

type ModeCommandStyle = {
  Icon: typeof AiIdea;
  /** Text color of the command inside the prompt. */
  className: string;
  /** Mode pill shown under the prompt while the mode is on. */
  pill?: { label: string; title: string; className: string };
  /** Rows that list the mode, such as a + menu or command list. */
  menu?: { label: string; description: string; iconClassName: string };
};

export const MODE_COMMAND_STYLES: Record<string, ModeCommandStyle> = {
  [PLAN_COMMAND.name]: {
    Icon: AiIdea,
    className: "text-warning dark:text-warning/90",
    pill: {
      label: "Plan",
      title: "Plan mode",
      className:
        "bg-warning/12 text-warning hover:bg-warning/18 dark:text-warning/90",
    },
    menu: {
      label: "Plan mode",
      description: "Review a plan before building",
      iconClassName: "text-warning/80",
    },
  },
  [OPERATOR_COMMAND.name]: {
    Icon: CursorMagicSelection,
    className: "text-accent dark:text-accent/90",
    pill: {
      label: "Operator",
      title: "Operator",
      className:
        "bg-accent/15 font-medium text-accent hover:bg-accent/20 dark:bg-accent/10 dark:text-accent/90 dark:hover:bg-accent/15",
    },
    menu: {
      label: "Operator",
      description: "Give this thread access to OmniCode",
      iconClassName: "text-accent/80",
    },
  },
  [ORCHESTRATOR_COMMAND.name]: {
    Icon: Share,
    className: "text-accent dark:text-accent/90",
    pill: {
      label: "Orchestrator",
      title: "Orchestrator mode",
      className:
        "bg-accent/15 font-medium text-accent hover:bg-accent/20 dark:bg-accent/10 dark:text-accent/90 dark:hover:bg-accent/15",
    },
    menu: {
      label: "Orchestrator",
      description: "Plan and coordinate agent work",
      iconClassName: "text-accent/65",
    },
  },
  [DRAFT_COMMAND.name]: {
    Icon: CircleDashed,
    className: "text-content/70",
    pill: {
      label: "Draft",
      title: "Draft mode",
      className:
        "border border-dashed border-content/25 bg-content/5 text-content/70 hover:bg-content/6 hover:text-content",
    },
    menu: {
      label: "Draft",
      description: "Save this message without starting the agent",
      iconClassName: "text-content/60",
    },
  },
  [BTW_COMMAND.name]: {
    Icon: MessageSquare,
    className: "text-success dark:text-success/90",
  },
};

/** First-line indent that, with the `/`, makes room for a mode icon. */
export const MODE_COMMAND_INDENT = "13px";

export type ModeCommandToken = {
  name: string;
  end: number;
  style: ModeCommandStyle;
};

/** Mode commands only take effect at the start of a prompt. */
export function leadingModeCommand(
  text: string,
  names: ReadonlySet<string>,
): ModeCommandToken | null {
  const match = text.match(/^\/([a-z]+)(?=\s|$)/);
  const name = match?.[1];
  if (!match || !name || !names.has(name)) return null;
  const style = MODE_COMMAND_STYLES[name];
  if (!style) return null;
  return { name, end: match[0].length, style };
}

/**
 * The leading command inside a prompt's highlight layer. The `/` keeps its
 * width so the textarea underneath stays in lockstep; the shared first-line
 * indent widens its slot to fit the icon, like the `@` of a file mention.
 */
export function ModeCommandText({
  text,
  mode,
  indent = MODE_COMMAND_INDENT,
  iconClassName = "size-3.5",
}: {
  text: string;
  mode: ModeCommandToken;
  indent?: string;
  iconClassName?: string;
}) {
  return (
    <span className={mode.style.className}>
      <span className="relative">
        <span className="text-transparent">{"/"}</span>
        <mode.style.Icon
          className={cn("absolute top-1/2 -translate-y-1/2", iconClassName)}
          style={{ left: `-${indent}` }}
        />
      </span>
      <span key={mode.name} className="composer-mode-shimmer">
        {text.slice(1, mode.end)}
      </span>
    </span>
  );
}

export function ModeCommandPill({
  name,
  onClear,
}: {
  name: string;
  onClear: () => void;
}) {
  const { t: uiT } = useTranslation();
  const style = MODE_COMMAND_STYLES[name];
  if (!style?.pill) return null;
  const { Icon, pill } = style;
  return (
    <Button variant="ghost" size="content"
      type="button"
      title={uiT("Turn off {value0}", { value0: String(uiT(pill.title)) })}
      aria-label={uiT("Turn off {value0}", { value0: String(uiT(pill.title)) })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClear}
      className={cn("flex h-6.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px]", pill.className)}
    >
      <Icon className="size-4" />
      <span className="composer-mode-shimmer">{uiT(pill.label)}</span>
      <X className="size-4" />
    </Button>
  );
}
