import { animate, useMotionValue } from "motion/react";
import { springs, motionGeometry } from "../../../shared/motion/tokens";
import { useLayoutEffect, useState } from "react";

/** Skins play a short kick on the send control as a message leaves. */
export function useSendKick(reducedMotion: boolean) {
  const [sendKick, setSendKick] = useState(false);
  const sendScale = useMotionValue(1);
  useLayoutEffect(() => {
    if (!sendKick) return;
    if (reducedMotion) {
      sendScale.set(1);
      setSendKick(false);
      return;
    }
    let stopped = false;
    let settle: ReturnType<typeof animate> | undefined;
    sendScale.set(motionGeometry.sendKickStart);
    const kick = animate(sendScale, motionGeometry.sendKickPeak, {
      ...springs.press,
      onComplete: () => {
        if (stopped) return;
        settle = animate(sendScale, 1, {
          ...springs.press,
          onComplete: () => { if (!stopped) setSendKick(false); },
        });
      },
    });
    return () => { stopped = true; kick.stop(); settle?.stop(); };
  }, [sendKick, reducedMotion, sendScale]);

  return { sendKick, setSendKick, sendScale };
}
