import { useEffect, useRef } from "react";
import type { Block } from "../features/sessions/model/session";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { loadHapticPreferences } from "./hapticPreferences";
import { attentionHaptic, hapticsCanTrack, lightImpact, outputHaptics, subscribeHapticsLifecycle, successHaptic } from "./haptics";
import { TranscriptHapticsTracker } from "./transcriptHaptics";

export function useTranscriptHaptics({ blocks, active, busy, scope, history, attention, completed = true }: {
  blocks: readonly Block[];
  active: boolean;
  busy: boolean;
  scope?: string;
  history?: readonly { id: string; text: string }[];
  attention?: string;
  completed?: boolean;
}) {
  const visible = useSurfaceVisibility() && active;
  const owner = useRef({});
  const tracker = useRef(new TranscriptHapticsTracker());
  const wasBusy = useRef(false);
  useEffect(() => {
    tracker.current = new TranscriptHapticsTracker();
    if (!visible) return;
    outputHaptics.claim(owner.current);
    const reset = () => {
      tracker.current = new TranscriptHapticsTracker();
    };
    const unsubscribe = subscribeHapticsLifecycle(reset);
    const token = owner.current;
    return () => { unsubscribe(); outputHaptics.release(token); };
  }, [visible, scope]);
  useEffect(() => {
    if (!visible || !hapticsCanTrack()) {
      tracker.current = new TranscriptHapticsTracker();
      return;
    }
    const change = tracker.current.update(blocks, busy, history, attention);
    if (!busy) outputHaptics.release(owner.current);
    // A turn can restart without the conversation component remounting.
    else if (!wasBusy.current) outputHaptics.claim(owner.current);
    wasBusy.current = busy;
    if (change.attention) void attentionHaptic();
    else if (change.finished && completed) void successHaptic();
    else if (change.phase) void lightImpact();
    if (busy && loadHapticPreferences().output)
      outputHaptics.add(owner.current, change.characters);
  }, [blocks, busy, visible, scope, history, attention, completed]);
}
