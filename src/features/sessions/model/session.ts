import { HARNESS_LABEL, HARNESS_TITLE } from "../../../contracts/session";
import { type HarnessId, type RuntimeMode, type Session, DEFAULT_RUNTIME_MODE } from "../../../contracts/session";













import { loadSharedAgentDefaults } from "../../settings/model/agentPreferences";
import { translate } from "../../../shared/i18n/language";
import { dropContextWindow } from "../../../domain/contextUsage";
import { stripSessionTitlePrefix } from "../../../domain/session";









import { defaultSessionChoice, firstEnabledHarness, loadUseLastSelection, preferredModelId, preferredModelSettings } from "./models";
import { resolveModel } from "../../../integrations/harness/core/modelCatalog";

import { loadProjectProviderSettings } from "./projectProviders";





export function newSession(
  harness: HarnessId = "claude",
  cwd = "~",
  model?: string,
  runtimeMode: RuntimeMode = DEFAULT_RUNTIME_MODE,
  modelSettings?: Record<string, string>,
): Session {
  const resolved = resolveModel(harness, model ?? preferredModelId(harness));
  return {
    id: crypto.randomUUID(),
    harness,
    model: resolved.id,
    modelSettings: preferredModelSettings(resolved, modelSettings),
    runtimeMode,
    title: HARNESS_LABEL[harness],
    titleState: { source: "placeholder", epoch: 0, purpose: "initial", fallbackAttempted: false },
    cwd,
    blocks: [],
  };
}

/** New conversation using the Providers defaults. */
export function newDefaultSession(
  cwd = "~",
  runtimeMode: RuntimeMode = loadSharedAgentDefaults().runtimeMode ?? DEFAULT_RUNTIME_MODE,
): Session {
  const choice = defaultSessionChoice(cwd);
  return newSession(choice.harness, cwd, choice.model, runtimeMode);
}

/**
 * Provider and model a seeded session should use in `cwd`. The project's own
 * default provider and model win over the seed; when the project has neither,
 * the seed's provider and model are carried. A provider the project hides is
 * swapped for its first enabled one.
 */
function projectSessionChoice(
  seed: Pick<Session, "harness" | "model"> | undefined,
  cwd: string,
): { harness: HarnessId; model?: string } {
  if (loadUseLastSelection()) return defaultSessionChoice(cwd);
  const project = loadProjectProviderSettings(cwd);
  const seedHarness = seed?.harness ?? "claude";
  const harness = firstEnabledHarness(
    cwd,
    project.defaultHarness ?? seedHarness,
  );
  const model =
    project.models?.[harness] ??
    (project.defaultHarness === harness ? project.defaultModel : undefined) ??
    (project.defaultHarness == null && harness === seedHarness
      ? seed?.model
      : undefined);
  return { harness, model };
}

/**
 * New conversation for a project. The project's default provider and model win
 * over the seed's; a provider the project has hidden is swapped for its first
 * enabled one.
 */
export function newSessionForProject(
  seed: Session | undefined,
  cwd: string,
): Session {
  const { harness, model } = projectSessionChoice(seed, cwd);
  const carriesSeed =
    model != null && model === seed?.model && harness === seed?.harness;
  return newSession(
    harness,
    cwd,
    model,
    seed?.runtimeMode,
    carriesSeed ? seed?.modelSettings : undefined,
  );
}

/**
 * Retarget an existing session (typically a blank one) to a project, adopting
 * that project's provider defaults while keeping its id, blocks and composer
 * seed.
 */
export function retargetSessionToProject(
  session: Session,
  cwd: string,
): Session {
  const { harness, model } = projectSessionChoice(session, cwd);
  const resolved = resolveModel(harness, model ?? preferredModelId(harness));
  const carriesSeed =
    model != null && model === session.model && harness === session.harness;
  return {
    ...session,
    cwd,
    harness,
    model: resolved.id,
    modelSettings: preferredModelSettings(
      resolved,
      carriesSeed ? session.modelSettings : undefined,
    ),
    title: HARNESS_LABEL[harness],
    titleState: { source: "placeholder", epoch: (session.titleState?.epoch ?? 0) + 1, purpose: "initial", fallbackAttempted: false },
    ...(harness === session.harness
      ? {}
      : { providerSessionId: undefined, providerAccountId: undefined }),
    // The account was chosen for the old project. The new project reads its
    // own stored choice, so a stamp carried over would show the wrong account.
    ...(cwd === session.cwd ? {} : { providerAccountId: undefined }),
    ...(resolved.id === session.model
      ? {}
      : { context: dropContextWindow(session.context) }),
  };
}

/** New conversation carrying another session's harness, model and settings. */
export function newSessionLike(
  seed: Session | undefined,
  cwd: string,
): Session {
  return newSession(
    seed?.harness ?? "claude",
    cwd,
    seed?.model,
    seed?.runtimeMode,
    seed?.modelSettings,
  );
}

/**
 * A session that still looks like an untouched draft the user never typed in:
 * no messages, no composer seed, no pending card, not bound to a provider thread.
 * Safe to reuse when the user asks for a new session in the same project.
 */
export function isReusableDraftSession(session: Session): boolean {
  if (session.blocks.length !== 0) return false;
  if (session.busy || session.worktreePreparing) return false;
  if (session.pendingSwitch) return false;
  if (session.worktreeRemoved) return false;
  if (session.providerSessionId) return false;
  if (session.nativeSession) return false;
  if (session.assistantOwnerId) return false;
  if (session.orchestrationLeadId) return false;
  if (session.workflowParentId) return false;
  if (session.inboxAsk) return false;
  if (session.composerSeed) return false;
  if (session.inboxCard) return false;
  if (session.noteCard) return false;
  if (session.linkedWorkItem) return false;
  if (session.linkedWorkItemUpdateCard) return false;
  if (session.handoffCard) return false;
  if (session.pendingQuestion) return false;
  if ((session.queuedMessages?.length ?? 0) > 0) return false;
  if (session.titleState && session.titleState.source !== "placeholder")
    return false;
  return true;
}

/** Title without the harness prefix stored for the tab strip. */
export function sessionDisplayTitle(title: string, harness: HarnessId): string {
  const stripped = stripSessionTitlePrefix(title, harness);
  if (stripped !== title) return stripped;
  if (title === HARNESS_LABEL[harness] || title === HARNESS_TITLE[harness]) {
    return translate("New session");
  }
  return title;
}
