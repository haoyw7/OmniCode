import { createContext, useContext } from "react";

/** Workspace views can stay mounted while their portalled surfaces are hidden. */
export const SurfaceVisibilityContext = createContext(true);

export function useSurfaceVisibility() {
  return useContext(SurfaceVisibilityContext);
}
