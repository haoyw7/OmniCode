import type { Session } from "./session";

export type SessionConfiguration = NonNullable<Session["pendingConfiguration"]>;

export function sessionComposerConfiguration(session: Session): SessionConfiguration {
  return session.pendingConfiguration ?? {
    harness: session.harness,
    model: session.model,
    modelSettings: session.modelSettings,
    runtimeMode: session.runtimeMode,
  };
}

/** Keep an established conversation's identity until a message is submitted. */
export function selectComposerConfiguration(
  session: Session,
  configuration: SessionConfiguration,
): Session {
  if (configuration.harness !== session.harness &&
      session.blocks.some(block => block.role === "user" && !block.draft)) {
    return { ...session, pendingConfiguration: configuration };
  }
  return { ...session, ...configuration, pendingConfiguration: undefined };
}
