import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import { reducedMotionQuery } from "../lib/reducedMotion";

const subscribe = (listener: () => void) => {
  const query = reducedMotionQuery();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const snapshot = () => reducedMotionQuery().matches;

export function useMotionPreference(): boolean {
  useReducedMotion();
  const reduced = useSyncExternalStore(subscribe, snapshot, () => false);
  return reduced;
}
