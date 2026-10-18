import type {
  AgentRunMeta,
  AgentStep,
  Block,
  Session,
} from "../../../features/sessions/model/session";
import {
  agentTranscript,
  updateAgentTool,
} from "../../../features/sessions/model/agentTranscript";
import { mergeToolPreview } from "./preview";
import type { HarnessEvent } from "./types";

type AgentEvent = Extract<
  HarnessEvent,
  { type: "agent.step" | "agent.updated" }
>;

export function applyAgentEvent(session: Session, event: AgentEvent): Session {
  const blocks = updateAgentTool(
    session.blocks,
    event.callId,
    (owner) => {
      const previous = owner.agentRun;
      const run: AgentRunMeta = {
        name: owner.tool?.title || owner.text || "Subagent",
        steps: [],
        ...previous,
        transcript: agentTranscript(owner),
        coverage:
          previous?.coverage ??
          (previous?.steps.length ? "partial" : "recorded"),
      };
      if (event.type === "agent.updated") {
        for (const key of [
          "name",
          "model",
          "agentType",
          "providerSessionId",
        ] as const) {
          if (event[key]) run[key] = event[key];
        }
        // A later full-looking update cannot erase a known gap.
        if (event.coverage && run.coverage !== "partial")
          run.coverage = event.coverage;
        if (
          event.prompt &&
          !run.transcript!.some((block) => block.role === "user")
        ) {
          run.transcript = [
            { id: `${event.callId}:prompt`, role: "user", text: event.prompt },
            ...run.transcript!,
          ];
        }
      } else {
        if (event.agentName) run.name = event.agentName;
        if (event.agentType) run.agentType = event.agentType;
        const rows = run.transcript!;
        const index = rows.findIndex((block) => block.id === event.stepId);
        const existing = rows[index];
        const text = event.append
          ? (existing?.text ?? "") + event.text
          : event.text || existing?.text || "";
        if (!text && event.kind !== "tool") return owner;
        const terminal = (status?: string) =>
          [
            "completed",
            "success",
            "failed",
            "error",
            "cancelled",
            "canceled",
          ].includes(status ?? "");
        const status =
          terminal(existing?.tool?.status) && !terminal(event.status)
            ? existing?.tool?.status
            : (event.status ?? existing?.tool?.status);
        const role =
          event.kind === "tool"
            ? "tool"
            : event.kind === "reasoning"
              ? "reasoning"
              : event.kind === "user"
                ? "user"
                : "assistant";
        const row: Block = {
          ...existing,
          id: event.stepId,
          role,
          text,
          ...(event.streaming !== undefined
            ? { streaming: event.streaming }
            : event.kind === "tool"
              ? {
                  streaming: !terminal(status),
                }
              : {}),
          ...(event.kind === "tool"
            ? {
                tool: {
                  ...existing?.tool,
                  callId:
                    event.toolCallId ?? existing?.tool?.callId ?? event.stepId,
                  title: text,
                  ...(event.toolKind ? { kind: event.toolKind } : {}),
                  ...(status ? { status } : {}),
                  ...(event.detail !== undefined
                    ? { detail: event.detail }
                    : {}),
                  ...(event.input !== undefined ? { input: event.input } : {}),
                  ...(event.output !== undefined
                    ? { output: event.output }
                    : {}),
                  preview: mergeToolPreview(
                    event.preview,
                    existing?.tool?.preview,
                  ),
                },
              }
            : {}),
        };
        if (
          existing &&
          existing.text === row.text &&
          existing.role === row.role &&
          existing.streaming === row.streaming &&
          JSON.stringify(existing.tool) === JSON.stringify(row.tool) &&
          previous?.name === run.name &&
          previous?.agentType === run.agentType
        )
          return owner;
        if (index < 0) run.transcript = [...rows, row];
        else {
          run.transcript = rows.slice();
          run.transcript[index] = row;
        }
        const detail = row.tool?.detail?.trim();
        const step: AgentStep = {
          id: event.stepId,
          kind: event.kind,
          text: text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text,
          toolKind: row.tool?.kind,
          status: row.tool?.status,
          ...(detail
            ? {
                detail:
                  detail.length > 8_000
                    ? `${detail.slice(0, 8_000)}\n…`
                    : detail,
              }
            : {}),
          ...(row.tool?.preview ? { preview: row.tool.preview } : {}),
        };
        const at = run.steps.findIndex((item) => item.id === step.id);
        run.steps = run.steps.slice();
        if (at < 0) run.steps.push(step);
        else run.steps[at] = step;
        run.steps = run.steps.slice(-300);
      }
      if (
        previous &&
        run.transcript === previous.transcript &&
        run.steps === previous.steps &&
        run.name === previous.name &&
        run.model === previous.model &&
        run.agentType === previous.agentType &&
        run.providerSessionId === previous.providerSessionId &&
        run.coverage === previous.coverage
      )
        return owner;
      return { ...owner, agentRun: run };
    },
    event.agentPath,
  );
  return blocks === session.blocks ? session : { ...session, blocks };
}
