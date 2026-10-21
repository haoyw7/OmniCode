import { translate } from "../../../shared/i18n/language";
import { buildDeterministicHandoff, buildHandoffComposerCard } from "./handoff";
import { turnEditedFiles } from "./secondOpinion";
import { newSession, sessionDisplayTitle, sessionExecutionCwd, type Session } from "./session";

/** Continue from a history recap without reusing the occupied provider conversation. */
export function forkSession(source: Session): Session {
  const history = { ...source, blocks: source.blocks.filter(block => !block.draft) };
  const lastUser = [...history.blocks].reverse().find(block => block.role === "user");
  return {
    ...newSession(source.harness, source.cwd, source.model, source.runtimeMode),
    executionCwd: source.executionCwd,
    branch: source.branch,
    providerAccountId: source.providerAccountId,
    modelSettings: { ...source.modelSettings },
    title: translate("{title} (fork)", { title: sessionDisplayTitle(source.title, source.harness) }),
    titleState: { source: "manual", epoch: 0, purpose: "initial", fallbackAttempted: false },
    handoffCard: buildHandoffComposerCard({
      from: source.harness,
      to: source.harness,
      brief: buildDeterministicHandoff(history),
      userRequest: lastUser?.text ?? "",
      files: turnEditedFiles(history.blocks, sessionExecutionCwd(source)),
    }),
  };
}
