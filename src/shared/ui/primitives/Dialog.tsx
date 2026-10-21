import { MotionPresenceItem } from "./MotionPresenceItem";
import { AnimatePresence, motion } from "motion/react";
import {
  immediateTransition,
  popAnimate,
  popExit,
  popInitial,
  popTransition,
} from "../../motion/tokens";
import { useMotionPreference } from "../../motion/useMotionPreference";
import { SurfaceAppearance } from "../SurfaceAppearance";
import { NativePopupHost } from "../NativePopupHost";
import { useSurfaceVisibility } from "../SurfaceVisibility";
import { useTranslation } from "../../i18n/useTranslation";
import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";
import { Button } from "../forms/Button";
import { X as XIcon } from "../icons";

const DialogMotionContext = React.createContext(false);

function Dialog({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <DialogMotionContext.Provider value={open}>
      <DialogPrimitive.Root
        data-slot="dialog"
        {...props}
        open={open}
        onOpenChange={(next) => {
          if (controlledOpen === undefined) setLocalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </DialogMotionContext.Provider>
  );
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const reduced = useMotionPreference();
  return (
    <MotionPresenceItem>
      <DialogPrimitive.Overlay
        asChild
        data-slot="dialog-overlay"
        data-window-modal-backdrop
        data-modal-context={React.useContext(SurfaceAppearance)}
        className={cn(
          // Linux 旧标题栏避让让模态遮罩从 48px 以下开始，窗口顶部仍保持高亮且 tooltip 可见。
          // renderer 自绘窗控位于同一窗口，模态态应与其它平台一致覆盖完整视口。
          "fixed inset-0 isolate z-50 bg-black/60  supports-backdrop-filter:backdrop-blur-xs    ",
          className,
        )}
        {...props}
      >
        <motion.div
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? immediateTransition : popTransition}
        />
      </DialogPrimitive.Overlay>
    </MotionPresenceItem>
  );
}

// 圆角规范迁移：默认外壳统一 2xl，三个截图/附件预览入口显式保留 xl，内容层级独立计算。
function DialogContent({
  className,
  children,
  showCloseButton = true,
  showOverlay = true,
  overlayClassName,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  showOverlay?: boolean;
  overlayClassName?: string;
}) {
  const open = React.useContext(DialogMotionContext);
  const reduced = useMotionPreference();
  const appearance = React.useContext(SurfaceAppearance);
  const host = React.useContext(NativePopupHost);
  const visible = useSurfaceVisibility();
  const previousFocus = React.useRef<Element | null>(null);
  const { t } = useTranslation();
  if (!visible) return null;
  const presence = (
    <AnimatePresence propagate>
      {open && (
        <React.Fragment key="dialog">
          {showOverlay && !host ? (
            <DialogOverlay
              key="overlay"
              className={overlayClassName}
              forceMount
            />
          ) : null}
          <MotionPresenceItem key="content">
            <DialogPrimitive.Content
              forceMount
              asChild
              data-slot="dialog-content"
              data-window-modal-panel
              data-modal-context={appearance}
              onOpenAutoFocus={(event) => {
                previousFocus.current = document.activeElement;
                onOpenAutoFocus?.(event);
              }}
              onCloseAutoFocus={(event) => {
                onCloseAutoFocus?.(event);
                if (event.defaultPrevented) return;
                const previous = previousFocus.current;
                if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert], [aria-hidden="true"]')) {
                  event.preventDefault();
                  previous.focus({ preventScroll: true });
                }
              }}
              className={cn(
                // Electron 自绘标题栏下，弹窗可能会落进窗口顶部的 drag 区域。
                // 如果不把弹窗内容整体标成 no-drag，右上角关闭按钮这类交互会被窗口拖拽命中吞掉。
                "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-popover-border bg-popover p-4 text-ui-base/relaxed text-foreground shadow-md  outline-none focus-visible:focus-fill       [app-region:no-drag]",
                className,
                host && "relative top-auto left-auto max-w-none translate-none",
              )}
              {...props}
            >
              <motion.div
                initial={reduced ? false : popInitial}
                animate={popAnimate}
                exit={popExit}
                transition={reduced ? immediateTransition : popTransition}
              >
                <div data-slot="dialog-body" className="contents" onKeyDown={(event) => { if (event.defaultPrevented) event.stopPropagation(); }}>
                  {children}
                </div>
                {showCloseButton && (
                  <DialogPrimitive.Close data-slot="dialog-close" asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="absolute top-4 right-4 z-20 hover:bg-surface-hover [app-region:no-drag]"
                      size="icon-sm"
                    >
                      <XIcon />
                      <span className="sr-only">{t("Close")}</span>
                    </Button>
                  </DialogPrimitive.Close>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </MotionPresenceItem>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
  return <DialogPortal forceMount container={host ?? undefined}>{presence}</DialogPortal>;
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="dialog-footer"
      data-ui="dialog-actions"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="secondary">{t("Close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-ui-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-ui-base/relaxed text-foreground-subtle *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
