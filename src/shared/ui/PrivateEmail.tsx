import { useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { useSurfaceVisibility } from "./SurfaceVisibility";

/**
 * With email masking on, keep account emails private in screenshots until
 * explicitly revealed; otherwise show them as plain text.
 */
export function PrivateEmail({ email, masked }: { email: string; masked: boolean }) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [revealed, setRevealed] = useState(false);
  const [wasMasked, setWasMasked] = useState(masked);
  const [wasVisible, setWasVisible] = useState(visible);
  if (masked !== wasMasked || visible !== wasVisible) {
    // A retained closing surface must mask its email before it can reopen.
    setWasMasked(masked);
    setWasVisible(visible);
    setRevealed(false);
  }
  if (!masked) {
    return (
      <span className="min-w-0 truncate" title={email}>
        {email}
      </span>
    );
  }
  const action = t(revealed ? "Hide email" : "Reveal email");

  return (
    <button
      type="button"
      aria-label={action}
      aria-pressed={revealed}
      title={action}
      className="pointer-events-auto relative min-w-0 truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
      onClick={(event) => {
        event.stopPropagation();
        setRevealed((value) => !value);
      }}
    >
      <span
        aria-hidden={!revealed}
        className={revealed ? undefined : "select-none blur-[5px]"}
      >
        {email}
      </span>
    </button>
  );
}
