import { useSyncExternalStore } from "react";
import { TAB_GROUP_LOGOS_CHANGED, tabGroupLogoDisplayRevision } from "../../workspace/model/tabGroups";
import { projectLogoSrc } from "./projectLogos";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(TAB_GROUP_LOGOS_CHANGED, onChange);
  return () => window.removeEventListener(TAB_GROUP_LOGOS_CHANGED, onChange);
}

/** Keep caller-owned logo data current after replacing an image at the same path. */
export function useProjectLogoSource(): typeof projectLogoSrc {
  useSyncExternalStore(subscribe, tabGroupLogoDisplayRevision, tabGroupLogoDisplayRevision);
  return projectLogoSrc;
}
