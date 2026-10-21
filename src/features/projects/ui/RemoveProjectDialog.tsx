import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { Button } from "../../../shared/ui/forms/Button";
import { ModalFooter } from "../../../shared/ui/Modal";
import { prettyCwd } from "../../../shared/lib/paths";
import { projectSessionCount } from "../model/projectData";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

type Props = {
  name: string;
  path: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Delete drops the project from the rail and its saved chats. The folder on
 * disk is left alone; opening it again brings the project back empty.
 */
export function RemoveProjectDialog({
  name,
  path,
  onCancel,
  onConfirm,
}: Props) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const { data: sessions } = useQuery({
    queryKey: ["projects", "session-count", path],
    queryFn: () => projectSessionCount(path),
    enabled: visible,
    gcTime: 0,
  }, queryClient);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (visible) cancelRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, onCancel]);

  if (!visible) return null;

  return createPortal(
    <div data-window-modal className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div data-window-modal-backdrop className="absolute inset-0 bg-black/30" onMouseDown={onCancel} />
      <div
        role="dialog"
        data-window-modal-panel
        aria-modal="true"
        aria-label={uiT("Delete {value0}", { value0: String(name) })}
        onMouseDown={(event) => event.stopPropagation()}
        className="popover-backdrop absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="desktop-pane-heading text-[13px] font-medium leading-tight text-content">
            {uiT("Delete “")}
            {name}”?
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            {uiT(
              "All conversations for this project will be deleted. It also leaves the sidebar. The folder on disk stays put, and opening it again brings the project back empty.",
            )}
          </p>
          {sessions != null && sessions > 0 ? (
            <p className="text-[12px] leading-snug text-content/45">
              {sessions === 1
                ? uiT("1 saved conversation will be removed.")
                : uiT("{value0} saved conversations will be removed.", {
                    value0: String(sessions),
                  })}
            </p>
          ) : null}
          <p className="truncate text-[11px] leading-tight text-content/40">
            {prettyCwd(path)}
          </p>
        </div>

        <ModalFooter>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {uiT("Cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {uiT("Delete")}
          </Button>
        </ModalFooter>
      </div>
    </div>,
    document.body,
  );
}
