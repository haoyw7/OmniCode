import { Suspense, type ReactNode } from "react";
import { motion, useIsPresent } from "motion/react";
import { AppSkeleton } from "../../../shared/ui/messaging/AppSkeleton";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../shared/ui/primitives/Dialog";
import { GlassBackdrop } from "../../../shared/ui/GlassBackdrop";
import { Button } from "../../../shared/ui/forms/Button";
import { X } from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { LAYER } from "../../../shared/lib/layers";
import {
  immediateTransition,
  popTransition,
} from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";

export function AppViewDialog({
  title,
  onClose,
  topInset = 0,
  children,
}: {
  title: string;
  onClose: () => void;
  topInset?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const present = useIsPresent();
  const reduced = useMotionPreference();
  return (
    <Dialog
      open={present}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {topInset > 0 ? (
        <motion.div
          aria-hidden
          data-window-chrome-backdrop
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? immediateTransition : popTransition}
          className="modal-backdrop pointer-events-none fixed inset-x-0 top-0 bg-black/40"
          style={{ zIndex: LAYER.windowChrome, height: topInset }}
        />
      ) : null}
      <DialogContent
        data-app-view-dialog
        aria-describedby={undefined}
        showCloseButton={false}
        className="app-view-dialog isolate flex w-[min(1024px,calc(100vw-32px))] flex-col gap-0 overflow-hidden rounded-xl p-0"
        style={{
          zIndex: LAYER.dialog,
          top: `calc(50% + ${topInset / 2}px)`,
          height: `min(800px, calc(100dvh - ${topInset + 32}px))`,
        }}
        overlayClassName="modal-backdrop app-view-dialog-backdrop bg-black/40"
      >
        <GlassBackdrop />
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Close")}
          onClick={onClose}
          className="app-view-dialog-close absolute right-3 top-3 z-[4] rounded-lg text-content/65 hover:bg-content/5 hover:text-content"
        >
          <X />
        </Button>
        <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col [&>*>*:first-child]:pr-10">
          <Suspense
            fallback={
              <AppSkeleton
                size="fullscreen"
                label={t("Loading…")}
                className="mt-12"
              />
            }
          >
            {children}
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
