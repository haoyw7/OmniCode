import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
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


  if (!visible) return null;

  return (
    <Modal title={uiT("Delete {value0}", { value0: String(name) })} size="sm" onClose={onCancel}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
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
    </Modal>
  );
}
