import { useTranslation } from "../../shared/i18n/useTranslation";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "../../shared/ui/icons";
import { useEffect, useState } from "react";
import { deferredWindowRefresh } from "./windowResizeWork";

export function WindowControls() {
  const { t: uiT } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    let revision = 0;

    const win = getCurrentWindow();
    const readMaximized = async () => {
      const current = ++revision;
      try {
        const max = await win.isMaximized();
        if (mounted && current === revision) setIsMaximized(max);
      } catch {}
    };
    const refresh = deferredWindowRefresh(() => { void readMaximized(); });
    void readMaximized();
    void win
      .onResized(() => {
        revision++;
        refresh.schedule();
      })
      .then((unlistenFn) => {
        if (mounted) {
          unlisten = unlistenFn;
        } else {
          unlistenFn();
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      refresh.dispose();
      unlisten?.();
    };
  }, []);

  const handleMinimize = () => {
    try {
      void getCurrentWindow().minimize();
    } catch {}
  };

  const handleToggleMaximize = () => {
    try {
      void getCurrentWindow().toggleMaximize();
    } catch {}
  };

  const handleClose = () => {
    try {
      void getCurrentWindow().close();
    } catch {}
  };

  return (
    <div
      role="group"
      aria-label={uiT("Window controls")}
      className="flex h-full shrink-0 items-center gap-1 px-2"
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        title={uiT("Minimize")}
        aria-label={uiT("Minimize window")}
        data-tauri-drag-region="false"
        onClick={handleMinimize}
        className="grid size-7 place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-content"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        title={isMaximized ? uiT("Restore") : uiT("Maximize")}
        aria-label={
          isMaximized ? uiT("Restore window") : uiT("Maximize window")
        }
        data-tauri-drag-region="false"
        onClick={handleToggleMaximize}
        className="grid size-7 place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-content"
      >
        {isMaximized ? (
          <Copy className="size-3" />
        ) : (
          <Square className="size-3" />
        )}
      </button>
      <button
        type="button"
        title={uiT("Close")}
        aria-label={uiT("Close window")}
        data-tauri-drag-region="false"
        onClick={handleClose}
        className="grid size-7 place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-red-600 hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
