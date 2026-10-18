import { translate, type UiLanguage } from "../../../shared/i18n/language";

/** Translate our rollback context while retaining npm output, paths and versions. */
export function harnessUpdateError(error: unknown, locale?: UiLanguage): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = (text: string): string => {
    const restored = /^Previous CLI installation restored \((.+)\)\.$/.exec(text);
    if (restored) return translate("Previous CLI installation restored ({version}).", { version: restored[1] }, locale);
    for (const [prefix, template, key] of [
      ["Cannot verify the installed CLI before updating: ", "Cannot verify the installed CLI before updating: {error}", "error"],
      ["Could not back up CLI; update was not started: ", "Could not back up CLI; update was not started: {error}", "error"],
      ["Rollback failed: ", "Rollback failed: {error}", "error"],
      ["Recovery files retained at ", "Recovery files retained at {path}", "path"],
    ]) {
      if (text.startsWith(prefix)) {
        const value = text.slice(prefix.length);
        return translate(template, { [key]: key === "error" ? line(value) : value }, locale);
      }
    }
    return translate(text, undefined, locale);
  };
  return message.split("\n").map(line).join("\n");
}
