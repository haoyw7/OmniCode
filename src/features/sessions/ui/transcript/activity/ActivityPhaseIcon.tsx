import {
  AiIdea,
  MessageSquare,
  PenLine,
  Bot,
  Search,
  Terminal,
  Wrench,
} from "../../../../../shared/ui/icons";
import { type ActivityPhaseKind } from "../../../model/transcriptActivity";



/** What the group was for, at a glance: look, change, run, think. */
export function ActivityPhaseIcon({
  kind,
  className = "",
}: {
  kind: ActivityPhaseKind;
  className?: string;
}) {
  const props = {
    "aria-hidden": true as const,
    className: `size-3.5 shrink-0 text-content/45 ${className}`,
    strokeWidth: 1.75,
  };
  if (kind === "edit") return <PenLine {...props} />;
  if (kind === "research") return <Search {...props} />;
  if (kind === "run") return <Terminal {...props} />;
  if (kind === "agent") return <Bot {...props} />;
  if (kind === "think") return <AiIdea {...props} />;
  if (kind === "other") return <Wrench {...props} />;
  return <MessageSquare {...props} />;
}
