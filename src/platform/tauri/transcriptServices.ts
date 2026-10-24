import { openExternalUrl } from "./browser";
import { pickNativeSavePath } from "./dialogs";
import { copyMessage, copyText } from "./clipboard";
import { openPathWithDefaultApp, readBinaryFile, revealPath, writeTextFile } from "./fs";
import { IS_MAC, IS_WIN } from "./platform";

/** Desktop-native operations injected at the application composition root. */
export const desktopTranscriptServices = {
  copyMessage: (...args: Parameters<typeof copyMessage>) => copyMessage(...args),
  copyText: (text: string) => copyText(text),
  openExternal: (url: string) => openExternalUrl(url),
  readBinaryFile: (path: string) => readBinaryFile(path),
  openPathWithDefaultApp: (path: string) => openPathWithDefaultApp(path),
  revealPath: (path: string) => revealPath(path),
  revealPathLabel: IS_MAC ? "Reveal in Finder" : IS_WIN ? "Reveal in File Explorer" : "Open Containing Folder",
  localFiles: true,
  liveClockInFooter: true,
  async saveText(fileName: string, text: string) {
    const path = await pickNativeSavePath({
      defaultPath: fileName,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) await writeTextFile(path, text);
  },
};
