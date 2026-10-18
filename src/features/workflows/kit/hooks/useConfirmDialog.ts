// Monocode shim for ZCode's confirm dialog: the platform confirm prompt.
import { useCallback } from "react";

export type ConfirmDialogRequest = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  confirmVariant?: "default" | "destructive";
};

export function useConfirmDialog(): (request: ConfirmDialogRequest) => Promise<boolean> {
  return useCallback(async (request) => window.confirm(request.description ? `${request.title}\n\n${request.description}` : request.title), []);
}
