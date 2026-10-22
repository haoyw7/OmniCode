import type { ReactNode } from "react";
export interface UsageDialogProps {
  title: string;
  size?: "sm" | "md" | "lg";
  onClose: () => void;
  children: ReactNode;
}
export type UsageDialogRenderer = (props: UsageDialogProps | null) => ReactNode;
