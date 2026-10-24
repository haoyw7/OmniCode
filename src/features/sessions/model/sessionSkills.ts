import { sessionExecutionCwd } from "../../../domain/session";
import { type HarnessId } from "../../../contracts/session";
import { hasNativeCommands, type SkillCatalogContext } from "../../skills/model/skills";

type SkillWarmupSession = {
  id?: string;
  harness: HarnessId;
  cwd: string;
  executionCwd?: string;
};

export function nativeSkillContextForSession(
  session: SkillWarmupSession,
): SkillCatalogContext | null {
  if (!hasNativeCommands(session.harness)) return null;
  return {
    harness: session.harness,
    cwd: sessionExecutionCwd(session),
    ...(session.id ? { sessionId: session.id } : {}),
  };
}
