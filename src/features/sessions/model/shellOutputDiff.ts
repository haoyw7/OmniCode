export type ShellOutputLineKind = "add" | "del" | "hunk" | "plain";

const HUNK = /^(@@ |diff --git |\+\+\+ |--- |index [0-9a-f]+\.\.)/;

function lineKind(line: string): ShellOutputLineKind {
  if (HUNK.test(line)) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "plain";
}

/**
 * Per-line diff kinds when a command printed a diff (or grep over one), so the
 * output can tint additions and removals. Ordinary output — a list with a few
 * dashed items, a flag dump — returns `undefined` and renders as it came.
 */
export function shellOutputDiffLines(
  text: string,
): ShellOutputLineKind[] | undefined {
  const lines = text.split("\n");
  const kinds = lines.map(lineKind);
  const filled = lines.filter((line) => line.trim()).length;
  const hunks = kinds.filter((kind) => kind === "hunk").length;
  const changes = kinds.filter((kind) => kind === "add" || kind === "del").length;
  if (hunks > 0 && changes > 0) return kinds;
  // Without a header, only output that is mostly +/- lines reads as a diff.
  if (changes >= 2 && changes / filled >= 0.4) {
    // Markdown-style bullets ("- item") are lists, not removals.
    const bullets = lines.filter((line) => /^[-+] \S/.test(line)).length;
    const indented = lines.filter((line) => /^[-+]( {2,}|\t)|^[-+]\S/.test(line)).length;
    if (bullets > 0 && indented === 0) return undefined;
    return kinds;
  }
  return undefined;
}
