import { getUiLanguage, translate } from "../../../../shared/i18n/language";
import { createContext, useContext, useEffect, useRef, useState } from "react";



export const TranscriptClockOffset = createContext(0);

/** Wall-clock time, ticking each second for the entire live turn. */
export function useNow(): number {
  const offset = useContext(TranscriptClockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now + offset;
}

const clockTimeFormats = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock stamp for a finished turn, in the reader's own locale. */
export function formatClockTime(epochMs: number): string {
  const language = getUiLanguage();
  let format = clockTimeFormats.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(language, {
      hour: "numeric",
      minute: "2-digit",
    });
    clockTimeFormats.set(language, format);
  }
  return format.format(epochMs);
}

export function useElapsedFrom(
  startedAt: number | undefined,
  paused: boolean,
): number | null {
  const offset = useContext(TranscriptClockOffset);
  // Pause bookkeeping and fallback clocks remain in the local time domain.
  const localStartedAt = startedAt == null ? undefined : startedAt - offset;
  const fallback = useRef<number | null>(null);
  const pausedMs = useRef(0);
  const pauseStarted = useRef<number | null>(null);
  const seenStartedAt = useRef(startedAt);

  if (seenStartedAt.current !== startedAt) {
    seenStartedAt.current = startedAt;
    fallback.current = null;
    pausedMs.current = 0;
    pauseStarted.current = paused ? Date.now() : null;
  }

  const origin = localStartedAt ?? (fallback.current ??= Date.now());
  const [elapsedMs, setElapsedMs] = useState(() =>
    Math.max(0, Date.now() - origin),
  );

  useEffect(() => {
    const start = localStartedAt ?? (fallback.current ??= Date.now());
    if (paused) {
      if (pauseStarted.current == null) pauseStarted.current = Date.now();
      return;
    }
    if (pauseStarted.current != null) {
      pausedMs.current += Date.now() - pauseStarted.current;
      pauseStarted.current = null;
    }
    const tick = () =>
      setElapsedMs(Math.max(0, Date.now() - start - pausedMs.current));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [localStartedAt, paused]);

  return elapsedMs;
}

export function formatWorkingDuration(
  elapsedMs: number | null,
  modelName?: string,
  done = false,
): string {
  const who = modelName?.trim();
  const elapsed = formatElapsed(elapsedMs);
  if (elapsed == null) {
    if (done) {
      return who
        ? translate("{model} worked", { model: who })
        : translate("Worked");
    }
    return who
      ? translate("{model} working…", { model: who })
      : translate("Working…");
  }
  return who
    ? translate(
        done ? "{model} worked for {duration}" : "{model} working for {duration}",
        { model: who, duration: elapsed },
      )
    : translate(done ? "Worked for {duration}" : "Working for {duration}", {
        duration: elapsed,
      });
}

export function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs == null) return null;
  const totalSec = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
