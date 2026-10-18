import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { Browser } from "@capacitor/browser";
import { copyText as browserCopyText } from "../platform/tauri/clipboard";
import type { Attachment } from "../features/sessions/model/session";

async function copyText(text: string) {
  if (Capacitor.isNativePlatform()) await Clipboard.write({ string: text });
  else await browserCopyText(text);
}
export const mobileTranscriptPlatform = {
  copyText,
  async copyMessage(text: string, attachments: Attachment[] = []) {
    await copyText(
      [text, ...attachments.map((item) => item.name)]
        .filter(Boolean)
        .join("\n"),
    );
  },
  async openExternal(url: string) {
    if (!/^https?:\/\//i.test(url)) return;
    if (Capacitor.isNativePlatform()) await Browser.open({ url });
    else window.open(url, "_blank", "noopener,noreferrer");
  },
  async readBinaryFile(_path: string): Promise<Uint8Array> {
    throw new Error("Host image is unavailable.");
  },
  localFiles: false,
  messageMotion: "slide" as const,
  toolDiffPreviews: false,
  answeredQuestionsInline: true,
};

export function createMobileTranscriptPlatform(
  readBinaryFile: (path: string) => Promise<Uint8Array>,
) {
  return { ...mobileTranscriptPlatform, readBinaryFile };
}
