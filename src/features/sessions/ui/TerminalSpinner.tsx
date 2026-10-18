import { useAnimationActivity } from "../../../shared/hooks/useAnimationActivity";
import "./TerminalSpinner.css";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function changeActivity(element: HTMLSpanElement, active: boolean) {
  element.style.animationPlayState = active ? "running" : "paused";
}

export function TerminalSpinner({
  className = "inline-block w-3.5 select-none text-center text-[11px] leading-none",
}: {
  className?: string;
}) {
  const activityRef = useAnimationActivity(changeActivity);

  return (
    <span ref={activityRef} aria-hidden className={`terminal-spinner ${className}`}>
      <span className="terminal-spinner-window">
        <span className="terminal-spinner-strip">
          {FRAMES.map((frame) => <span key={frame}>{frame}</span>)}
        </span>
      </span>
    </span>
  );
}
