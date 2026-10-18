import type {
  HostModelCatalog,
  RemoteProvider,
} from "../features/connections/model/protocol";
import type { Session } from "../features/sessions/model/session";
import type { ContextUsage } from "../features/sessions/model/contextUsage";

/** Use a real usage reading and, if needed, the exact model's Host catalog limit. */
export function mobileContextUsage(
  session: Session | undefined,
  catalog?: HostModelCatalog,
): ContextUsage | undefined {
  const usage = session?.context;
  if (!session || !usage || !Number.isFinite(usage.used) || usage.used < 0)
    return undefined;
  const reportedWindow = validWindow(usage.window);
  const catalogWindow =
    reportedWindow ??
    validWindow(
      catalog?.models[session.harness as RemoteProvider]?.find(
        (model) =>
          model.id === session.model && model.harness === session.harness,
      )?.contextWindow,
    );
  return {
    used: usage.used,
    ...(catalogWindow ? { window: catalogWindow } : {}),
    ...(usage.breakdown ? { breakdown: usage.breakdown } : {}),
  };
}

function validWindow(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
