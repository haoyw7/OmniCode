import {
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { TextRevealQueue } from "./textRevealQueue";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

/** Seed loaded history and pace only new output on every transcript client. */
export function useTranscriptRenderingPlatform(
  entries: readonly { id: string; text: string }[],
  {
    historyReady = entries.length > 0,
    historyIds,
    historyEntries,
    animateFrom,
  }: {
    historyReady?: boolean;
    historyIds?: ReadonlySet<string>;
    historyEntries?: readonly { id: string; text: string }[];
    animateFrom?: string;
  } = {},
) {
  const platform = useContext(TranscriptPlatformContext);
  const visible = useSurfaceVisibility();
  const wasVisible = useRef(visible);
  useLayoutEffect(() => {
    wasVisible.current = visible;
  }, [visible]);
  const lengths = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry.text.length])),
    [entries],
  );
  const historyLengths = useMemo(
    () => new Map(historyEntries?.map((entry) => [entry.id, entry.text.length])),
    [historyEntries],
  );
  const queue = useMemo(() => new TextRevealQueue(), []);
  useLayoutEffect(() => queue.setOrder([...lengths.keys()]), [queue, lengths]);
  const currentLengths = useRef(lengths);
  currentLengths.current = lengths;
  const seenLengths = useRef(new Map<string, number>());
  const settledLengths = useRef(new Map<string, number>());
  const seededReveal = useRef(false);
  if (!seededReveal.current && historyReady) {
    const start = animateFrom
      ? entries.findIndex((entry) => entry.id === animateFrom)
      : -1;
    seenLengths.current = new Map(
      entries.map((entry, index) => [
        entry.id,
        start >= 0 && index > start ? 0 : entry.text.length,
      ]),
    );
    seededReveal.current = true;
  }
  // Older pages arrive after first paint, but their replies are already complete.
  if (historyIds)
    for (const entry of entries)
      if (historyIds.has(entry.id) && !seenLengths.current.has(entry.id))
        seenLengths.current.set(entry.id, entry.text.length);
  // Hidden panes pause their prop updates. On return, both mounted replies
  // and newly received blocks must catch up before any fresh output is paced.
  if (!visible || !wasVisible.current) {
    settledLengths.current = lengths;
    for (const [id, length] of lengths) seenLengths.current.set(id, length);
  }
  const revealText = useCallback(
    (id?: string) => {
      if (!id) return {};
      const settledLength = Math.max(
        settledLengths.current.get(id) ?? 0,
        historyLengths.get(id) ?? 0,
      );
      const initialLength = Math.max(seenLengths.current.get(id) ?? 0, settledLength);
      // Reopening a previously presented reply must not replay it.
      seenLengths.current.set(id, currentLengths.current.get(id) ?? 0);
      return {
        initialLength,
        settledLength,
        sequence: queue.forEntry(id),
      };
    },
    [queue, visible, historyLengths],
  );
  return useMemo(
    () => ({ ...platform, textReveal: revealText, textRevealQueue: queue }),
    [platform, revealText, queue],
  );
}

const subscribeIdle = () => () => {};
const idle = () => false;

/** Wait for both the provider stream and the visible character reveal. */
export function AfterTextReveal({
  entries,
  children,
}: {
  entries: readonly { id: string; streaming?: boolean }[];
  children: ReactNode;
}) {
  const { textRevealQueue: queue } = useContext(TranscriptPlatformContext);
  const pending = useSyncExternalStore(
    queue?.subscribe ?? subscribeIdle,
    () => entries.some((entry) => queue?.isPending(entry.id)),
    idle,
  );
  return pending || entries.some((entry) => entry.streaming) ? null : children;
}
