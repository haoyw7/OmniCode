import { createContext, type RefObject } from "react";

export const MenuSubmenuContext = createContext<{
  anchor: RefObject<HTMLButtonElement | null>;
} | null>(null);
