import { motion } from "motion/react";
import { popTransition, immediateTransition, motionDistance } from "../shared/motion/tokens";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useCollapseMotion } from "../shared/ui/AnimatedCollapse";
import { Search } from "../shared/ui/icons";

/** Home search replaces the leading controls while retaining closing motion. */
export function MobileHeaderSearch({
  open,
  query,
  onQueryChange,
  onClose,
  trigger,
}: {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const reduced = useMotionPreference();
  const input = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const { foldState, finish } = useCollapseMotion(open);
  useLayoutEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
    else if (wasOpen.current)
      trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, trigger]);

  if (!open && foldState === "closed") return null;
  return (
    <motion.label
      initial={{ opacity: 0, x: motionDistance.pop }}
      animate={{ opacity: open ? 1 : 0, x: open ? 0 : motionDistance.pop }}
      transition={reduced ? immediateTransition : popTransition}
      onAnimationComplete={finish}
      className="mobile-header-search"
      data-fold-state={foldState}
      aria-hidden={!open || undefined}
      inert={!open}
    >
      <Search size={18} aria-hidden="true" />
      <input data-ui="input"
        ref={input}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
        aria-label={t("Search conversations")}
        placeholder={t("Search conversations...")}
      />
    </motion.label>
  );
}
