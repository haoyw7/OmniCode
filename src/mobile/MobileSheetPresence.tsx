import { cloneElement, useRef, type ReactElement } from "react";
import { AnimatePresence, usePresence } from "motion/react";

type SheetElement = ReactElement<{ open?: boolean; onExited?: () => void }>;

function PresentSheet({ children }: { children: SheetElement }) {
  const [present, safeToRemove] = usePresence();
  const current = useRef(present);
  current.current = present;
  return cloneElement(children, {
    open: present,
    onExited: () => {
      // A late completion from the previous close cannot remove a reopened sheet.
      if (current.current) return;
      children.props.onExited?.();
      safeToRemove?.();
    },
  });
}

/** AnimatePresence freezes a departing payload until its actual sheet exit finishes. */
export function MobileSheetPresence({ open, children }: {
  open: boolean;
  children: SheetElement | null;
}) {
  return <AnimatePresence>
    {open && children ? <PresentSheet key="sheet">{children}</PresentSheet> : null}
  </AnimatePresence>;
}
