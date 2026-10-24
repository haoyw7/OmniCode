import { noteCardMeta } from "../../domain/notesText";
import type { NoteComposerCard, HarnessId, PlanBuildTarget, PlanStatus, SecondOpinionMeta, Session } from "../../contracts/session";
import { dropContextWindow } from "../../domain/contextUsage";
import { planComposerSwitch } from "../../domain/handoff";
import { mergeModelSettings } from "../../features/sessions/model/models";
import { resolveModel } from "../../integrations/harness/core/modelCatalog";
import { sessionDisplayTitle } from "../../features/sessions/model/session";
import { formatSessionTitle } from "../../domain/session";
import { HARNESS_LABEL } from "../../contracts/session";


export function withPlanStatus(
  session: Session,
  blockId: string,
  status: PlanStatus,
): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === blockId && block.role === "plan"
        ? {
            ...block,
            plan: { ...(block.plan ?? { status: "ready" }), status },
          }
        : block,
    ),
  };
}

export function lastAssistantTextInTurn(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

export function userTurnCards(
  noteCard: NoteComposerCard | undefined,
  secondOpinion?: SecondOpinionMeta,
) {
  if (!noteCard && !secondOpinion) return undefined;
  return {
    ...(secondOpinion ? { secondOpinion } : {}),
    ...(noteCard ? { noteCard: noteCardMeta(noteCard) } : {}),
  };
}

export function withHarnessChoice(
  session: Session,
  harness: HarnessId,
  model: string,
  modelSettings: Record<string, string>,
): Session {
  return {
    ...session,
    pendingConfiguration: undefined,
    harness,
    model,
    modelSettings,
    title:
      session.blocks.length === 0
        ? HARNESS_LABEL[harness]
        : formatSessionTitle(
            harness,
            sessionDisplayTitle(session.title, session.harness),
          ),
    ...(session.model === model
      ? {}
      : { context: dropContextWindow(session.context) }),
    ...(session.harness === harness
      ? {}
      : { providerSessionId: undefined, providerAccountId: undefined }),
  };
}

export function withPlanBuildTarget(
  session: Session,
  target: PlanBuildTarget,
): Session {
  const resolved = resolveModel(target.harness, target.model);
  const modelSettings = mergeModelSettings(resolved, target.modelSettings);
  const plan = planComposerSwitch(session, target.harness);
  const next = withHarnessChoice(
    session,
    target.harness,
    resolved.id,
    modelSettings,
  );

  if (plan.kind === "arm") {
    return { ...next, pendingSwitch: plan.pending };
  }
  if (plan.kind === "revert") {
    return {
      ...next,
      pendingSwitch: undefined,
      ...(plan.restoreProviderSessionId
        ? { providerSessionId: plan.restoreProviderSessionId }
        : { providerSessionId: undefined }),
      ...(plan.restoreProviderAccountId
        ? { providerAccountId: plan.restoreProviderAccountId }
        : { providerAccountId: undefined }),
    };
  }
  if (plan.kind === "empty") {
    return { ...next, pendingSwitch: undefined };
  }
  return next;
}

export function lastUserBlockId(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i]?.role === "user") return session.blocks[i]?.id;
  }
  return undefined;
}

export function providerSignInRequestKey(session: Session): string {
  const lastBlockId = session.blocks[session.blocks.length - 1]?.id;
  return `${session.id}:${lastUserBlockId(session) ?? lastBlockId ?? "auth"}`;
}

export function sameSettings(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}
