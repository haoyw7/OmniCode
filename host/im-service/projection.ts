import type { BotMessage } from "../../src/features/bots/model/botView";
import { translate, type UiLanguage } from "../../src/shared/i18n/language";

/** Conservative byte budget, including room for JSON escaping on the wire. */
export function splitImText(text: string): string[] {
  const parts: string[] = [];
  let part = "", bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(JSON.stringify(char)) - 2;
    if (bytes + size > 8000) { parts.push(part); part = ""; bytes = 0; }
    part += char;
    bytes += size;
  }
  if (part) parts.push(part);
  return parts;
}

/** Only already-public assistant messages enter a platform projection. */
export function messageText(message: BotMessage, language: UiLanguage): string | undefined {
  switch (message.kind) {
    case "user": return undefined;
    case "assistant": return message.streaming ? undefined : message.text;
    case "session-card": return translate("Session: {title}\nProject: {project}\nStatus: {status}", {
      title: message.title, project: message.projectName, status: translate(message.status, undefined, language),
    }, language);
    case "status": return translate(message.text, undefined, language);
    case "input": return message.resolved ? undefined
      : `${message.text}\n\n${translate("Open OmniCode to respond to this request.", undefined, language)}`;
  }
}
