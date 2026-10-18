/** Keep the wire/history format compatible with existing assistant replies. */
export function quoteBotReply(text: string) {
  return text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
}

/** A leading Markdown quote followed by a blank line is a quoted reply. */
export function splitBotReply(text: string) {
  const separator = /\r?\n\r?\n/.exec(text);
  if (!separator) return undefined;
  const lines = text.slice(0, separator.index).split(/\r?\n/);
  if (!lines.every((line) => /^>(?: |$)/.test(line))) return undefined;
  return {
    quote: lines.map((line) => line.replace(/^> ?/, "")).join("\n"),
    text: text.slice(separator.index + separator[0].length),
  };
}
