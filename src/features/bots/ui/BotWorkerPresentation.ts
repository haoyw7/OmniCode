import { createContext, type ComponentType } from "react";
import type { HostSession } from "../../../contracts/protocol";

export type BotWorkerTranscriptProps = {
  snapshot: HostSession;
  visible: boolean;
};

/** Each client composes the read-only worker with its conversation renderer. */
export const BotWorkerTranscriptContext = createContext<ComponentType<BotWorkerTranscriptProps> | undefined>(undefined);
