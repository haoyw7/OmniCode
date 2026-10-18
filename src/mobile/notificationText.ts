/** Plain notification text, including previews supplied by older Hosts.
 * Keep in sync with Android's NotificationPresentation.plainText.
 */
export function notificationText(value: string | null | undefined): string {
  if (!value) return "";
  const literals: string[] = [];
  const protect = (text: string) => `\0${literals.push(text) - 1}\0`;
  let text = value.replace(/\0/g, "").replace(/\r\n?/g, "\n")
    .replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n\s*\2\s*(?=\n|$)|$)/g,
      (_match, start: string, _fence: string, code: string) => start + protect(code))
    .replace(/(`+)([^`]+?)\1/g, (_match, _mark: string, code: string) => protect(code))
    .replace(/\\([\\`*{}\[\]()#+.!_>~|\-])/g, (_match, literal: string) => protect(literal))
    .replace(/^\s{0,3}\[[^\]\n]+\]:\s+\S+.*$/gm, "")
    .replace(/!?(\[([^\]\n]*)\])\((?:[^()\n]|\([^()\n]*\))*\)/g, "$2")
    .replace(/!?\[([^\]\n]+)\]\[[^\]\n]*\]/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+|[^<>\s]+@[^<>\s]+)>/g, "$1")
    .replace(/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|=+)\s*$/gm, "")
    .replace(/^\s*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?\s*$/gm, "")
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_match, row: string) => row.replace(/\|/g, " "))
    .replace(/^\s{0,3}(?:>\s*)+/gm, "")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm, "$1")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, "$1")
    .replace(/\*(\S(?:[\s\S]*?\S)?)\*/g, "$1")
    .replace(/(^|\W)__(\S(?:[\s\S]*?\S)?)__(?=\W|$)/g, "$1$2")
    .replace(/(^|\W)_(\S(?:[\s\S]*?\S)?)_(?=\W|$)/g, "$1$2")
    .replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, "$1");
  // Hosts may truncate a preview inside a Markdown span.
  if (text.endsWith("…")) text = text.replace(/(^|\s)(?:\*{1,3}|_{1,3}|~~|`+)(?=\S)/g, "$1");
  return text.replace(/\0(\d+)\0/g, (_match, index: string) => literals[Number(index)])
    .replace(/\s+/g, " ").trim();
}
