import { agentStepCount } from "../../../model/agentTranscript";
import { ProjectMascot } from "../../../../projects/ui/ProjectMascot";
import { type AgentStep, type Block } from "../../../model/session";
import {
  isFailedStatus,
  toolCallState,
  type ToolCallState,
} from "../../../model/transcriptActivity";



/**
 * The Omi mascot standing in for a subagent, hopping while it works. The
 * sprite is hashed off the agent's name, so the same reviewer keeps the same
 * face across a session and two agents in a row are told apart at a glance.
 */
export function SubagentMascot({
  name,
  state,
  active = false,
}: {
  name: string;
  state: ToolCallState;
  active?: boolean;
}) {
  return (
    <ProjectMascot
      project={name}
      active={active}
      className={`size-3.5 shrink-0 ${
        state === "rejected"
          ? "text-red-400"
          : state === "pending"
            ? "text-content/70"
            : "text-content/45"
      }`}
    />
  );
}

/**
 * A mirrored step as the transcript block it stands for, so a subagent's trail
 * goes through the same rows — labels, file chips, diffs — as the main agent's.
 */
/** What a delegated run is up to: its newest step, or how much it got through. */
/**
 * A run is counted, never narrated. Echoing the call in flight put a second
 * scrolling command line on every row — the shimmer on the name already says
 * the agent is working, and the count says how far it has got.
 */
export function subagentStatusLine(block: Block, steps: AgentStep[]): string {
  if (toolCallState(block) === "rejected") return "failed";
  const fullTools = block.agentRun?.transcript?.filter((row) => row.role === "tool");
  const tools = agentStepCount(block);
  if (tools === 0) return "";
  const count = tools === 1 ? "1 step" : `${tools} steps`;
  // A step that failed inside a run that went on to finish still has to say so
  // here, or the row reads clean until someone opens the trail.
  const failed = fullTools?.filter((row) => isFailedStatus(row.tool?.status)).length ?? steps.filter(
    (step) => step.kind === "tool" && isFailedStatus(step.status),
  ).length;
  if (!failed) return count;
  return `${count}, ${failed === 1 ? "1 failed" : `${failed} failed`}`;
}
