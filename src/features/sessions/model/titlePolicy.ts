import {
  HARNESS_LABEL,
  HARNESS_TITLE,
  formatSessionTitle,
  type Session,
} from "./session";

export type SessionTitleState = {
  source: "placeholder" | "native" | "generated" | "manual";
  epoch: number;
  purpose: "initial" | "automation";
  fallbackAttempted: boolean;
};

export function sanitizeTitleState(
  value: unknown,
): SessionTitleState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const s = value as SessionTitleState;
  if (
    !["placeholder", "native", "generated", "manual"].includes(s.source) ||
    !Number.isSafeInteger(s.epoch) ||
    s.epoch < 0 ||
    !["initial", "automation"].includes(s.purpose) ||
    typeof s.fallbackAttempted !== "boolean"
  )
    return undefined;
  return {
    source: s.source,
    epoch: s.epoch,
    purpose: s.purpose,
    fallbackAttempted: s.fallbackAttempted,
  };
}

export function titleStateFor(session: Session): SessionTitleState {
  const saved = sanitizeTitleState(session.titleState);
  if (saved) return saved;
  const placeholder = [
    HARNESS_LABEL[session.harness],
    HARNESS_TITLE[session.harness],
    "New remote session",
  ].includes(session.title);
  return {
    source: placeholder ? "placeholder" : "manual",
    epoch: 0,
    purpose: "initial",
    fallbackAttempted: false,
  };
}

export function beginTitleCycle(session: Session, refresh = false): Session {
  const state = titleStateFor(session);
  if (state.source === "manual") return session;
  return {
    ...session,
    titleState: {
      ...state,
      source: "placeholder",
      epoch: state.epoch + 1,
      purpose: refresh ? "automation" : "initial",
      fallbackAttempted: false,
    },
  };
}

export function manualSessionTitle(session: Session, title: string): Session {
  const state = titleStateFor(session);
  return {
    ...session,
    title,
    titleState: { ...state, source: "manual", epoch: state.epoch + 1 },
  };
}

export function usefulNativeTitle(
  raw: unknown,
  providerSessionId?: string,
): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.trim();
  if (
    !title ||
    title.length > 4096 ||
    title.includes("\0") ||
    title === providerSessionId ||
    /^(?:new|child) session(?:\s*[-·:].*)?$/i.test(title) ||
    /^session\s+[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(title)
  )
    return null;
  return title;
}

export function applyNativeTitle(
  session: Session,
  providerSessionId: string,
  raw: unknown,
): Session {
  const state = titleStateFor(session);
  const title = usefulNativeTitle(raw, providerSessionId);
  if (
    !title ||
    session.providerSessionId !== providerSessionId ||
    state.source === "manual" ||
    state.purpose === "automation"
  )
    return session;
  const formatted = formatSessionTitle(session.harness, title);
  if (session.title === formatted && state.source === "native") return session;
  return {
    ...session,
    title: formatted,
    titleState: { ...state, source: "native" },
  };
}

export function applyGeneratedTitle(
  session: Session,
  epoch: number,
  raw: string,
): Session {
  const state = titleStateFor(session);
  if (
    state.epoch !== epoch ||
    state.source === "manual" ||
    state.source === "native" ||
    !raw.trim()
  )
    return session;
  return {
    ...session,
    title: formatSessionTitle(session.harness, raw),
    titleState: { ...state, source: "generated", fallbackAttempted: true },
  };
}
