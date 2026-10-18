import { createContext } from "react";

/** Travels through React portals; settings dialogs have no source-defined motion. */
export const SurfaceAppearance = createContext<"settings" | undefined>(undefined);
