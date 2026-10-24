import { createContext } from "react";
import type { TextRevealOptions } from "./wordFade";
import type { TextRevealQueue } from "./textRevealQueue";
import type { Attachment, Block, TurnOrigin } from "../../../contracts/session";

/** Clients supply native services; shared rendering never loads a native runtime. */
export type TranscriptPlatform = {
  copyMessage: (text: string, attachments?: Attachment[]) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  readBinaryFile: (path: string) => Promise<Uint8Array>;
  localFiles: boolean;
  /** Optional client feedback when the user starts copying a message. */
  onCopy?: () => void;
  openPathWithDefaultApp?: (path: string) => Promise<void>;
  revealPath?: (path: string) => Promise<void>;
  revealPathLabel?: string;
  textReveal?: (blockId?: string) => TextRevealOptions;
  textRevealQueue?: TextRevealQueue;
  /** Animate message entrances and layout alongside character reveal. */
  messageMotion?: "slide";
  /** Clients without a side panel show a finished tool call's details on tap. */
  openTool?: (block: Block) => void;
  openAgent?: (block: Block) => void;
  openBot?: (origin: TurnOrigin) => void | Promise<void>;
  /** Clients without a side panel list a group's steps in a sheet instead of unfolding it inline. */
  openActivity?: (steps: Block[]) => void;
  /** Clients without a side panel read a whole plan in their own view. */
  openPlan?: (blockId: string) => void;
  /** Show answered questions as a flat question/answer list instead of a fold (default: true). */
  answeredQuestionsInline?: boolean;
  /** Open a saved question in the client's answer surface. */
  openQuestion?: (blockId: string) => void;
  /** The client shows the live turn clock elsewhere, so fold lines name only the phase. */
  liveClockInFooter?: boolean;
  /** Save generated text, such as a plan, where the user chooses. */
  saveText?: (fileName: string, text: string) => Promise<void>;
  /** Resolve shared note assets on clients that cannot access Tauri files. */
  resolveNoteImage?: (asset: string) => Promise<string>;
};

const unavailable = async () => { throw new Error("This client has not supplied the requested native service."); };
export const TranscriptPlatformContext = createContext<TranscriptPlatform>({
  copyMessage: unavailable,
  copyText: unavailable,
  openExternal: unavailable,
  readBinaryFile: unavailable,
  localFiles: false,
  liveClockInFooter: true,
});
