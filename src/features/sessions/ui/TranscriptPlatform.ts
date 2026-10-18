import { createContext } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { copyMessage, copyText } from "../../../platform/tauri/clipboard";
import { readBinaryFile, writeTextFile } from "../../../platform/tauri/fs";
import type { TextRevealOptions } from "./wordFade";
import type { TextRevealQueue } from "./textRevealQueue";
import type { Block } from "../model/session";

/** Rendering stays shared; each client supplies its native services. */
const desktopPlatform = {
  copyMessage: (...args: Parameters<typeof copyMessage>) =>
    copyMessage(...args),
  copyText: (text: string) => copyText(text),
  openExternal: (url: string) => openUrl(url),
  readBinaryFile: (path: string) => readBinaryFile(path),
  localFiles: true,
  // The mascot and turn clock sit under the live reply on every client.
  liveClockInFooter: true,
};
export const TranscriptPlatformContext = createContext<
  Omit<typeof desktopPlatform, "liveClockInFooter"> & {
    textReveal?: (blockId?: string) => TextRevealOptions;
    textRevealQueue?: TextRevealQueue;
    /** Animate message entrances and layout alongside character reveal. */
    messageMotion?: "slide";
    /** Clients without a side panel show a finished tool call's details on tap. */
    openTool?: (block: Block) => void;
    /** Show desktop hover/focus diff popovers; touch clients use their detail sheets. */
    toolDiffPreviews?: boolean;
    openAgent?: (block: Block) => void;
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
  }
>({
  ...desktopPlatform,
  saveText: async (fileName, text) => {
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) await writeTextFile(path, text);
  },
});
