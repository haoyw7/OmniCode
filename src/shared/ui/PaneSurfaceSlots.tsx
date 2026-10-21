import { createContext, useContext, type ReactNode } from "react";

export type PaneSurfaceSlot = {
  content: (id: string, visible: boolean) => ReactNode;
  actions?: (id: string) => ReactNode;
};

export const PaneSurfaceSlots = createContext<Readonly<Record<string, PaneSurfaceSlot>>>({});
export function usePaneSurfaceSlot(kind: string) { return useContext(PaneSurfaceSlots)[kind]; }
