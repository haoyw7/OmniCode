import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { subscribeSharedPreferences } from "./sharedPreferences";

/** Retains local interaction state, then refreshes from the store on a Host update. */
export function usePreferenceState<T>(read: () => T): [T, Dispatch<SetStateAction<T>>] {
  const readRef = useRef(read);
  readRef.current = read;
  const [value, setValue] = useState(read);
  useEffect(() => subscribeSharedPreferences(() => setValue(readRef.current())), []);
  return [value, setValue];
}
