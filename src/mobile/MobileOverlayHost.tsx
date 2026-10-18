import { createContext } from "react";

/** Fixed surfaces stay outside the transformed navigation layers. */
export const MobileOverlayHostContext = createContext<HTMLElement | null>(null);
/** Portals keep the stacking level of the fullscreen surface that owns them. */
export const MobileOverlayLevelContext = createContext<number | undefined>(undefined);
