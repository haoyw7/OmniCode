type Node = Record<string, unknown>;
const node = (value: unknown): Node => value && typeof value === "object" ? value as Node : {};
const children = (value: unknown): Node[] => Array.isArray(node(value).content) ? (node(value).content as unknown[]).map(node) : [];
const type = (value: unknown) => node(value).type;
const attr = (value: unknown, key: string) => node(node(value).attrs)[key];
const textAttr = (value: unknown, key: string) => typeof attr(value, key) === "string" ? attr(value, key) as string : "";

function marked(value: Node): string {
  let text = typeof value.text === "string" ? value.text : "";
  if (!text) return text;
  const marks = Array.isArray(value.marks) ? value.marks : [];
  if (marks.some(mark => type(mark) === "code")) return `\`${text}\``;
  for (const mark of marks) {
    switch (type(mark)) {
      case "strong": text = `**${text}**`; break;
      case "em": text = `_${text}_`; break;
      case "strike": text = `~~${text}~~`; break;
      case "link": { const href = textAttr(mark, "href"); if (href) text = `[${text}](${href})`; break; }
    }
  }
  return text;
}

function inline(values: Node[]): string {
  return values.map(value => {
    switch (type(value)) {
      case "text": return marked(value);
      case "hardBreak": return "\n";
      case "mention": { const text = textAttr(value, "text"); return text && !text.startsWith("@") ? `@${text}` : text; }
      case "emoji": return textAttr(value, "text") || textAttr(value, "shortName");
      case "inlineCard": case "blockCard": case "embedCard": { const url = textAttr(value, "url"); return url ? `<${url}>` : ""; }
      case "status": return `\`${textAttr(value, "text")}\``;
      case "date": return "";
      default: return inline(children(value));
    }
  }).join("");
}
function blocks(values: Node[], indent: string): string { return values.map(value => block(value, indent)).filter(value => value.trim()).join("\n\n"); }
function list(value: Node, indent: string, start?: number): string {
  const lines: string[] = [];
  children(value).forEach((item, index) => {
    const marker = start === undefined ? "- " : `${start + index}. `;
    const nested = indent + " ".repeat(marker.length);
    let first = true;
    for (const child of children(item)) {
      const text = block(child, nested);
      if (!text.trim()) continue;
      if (type(child) === "bulletList" || type(child) === "orderedList") lines.push(text);
      else { lines.push(`${first ? indent + marker : nested}${text.replaceAll("\n", `\n${nested}`)}`); first = false; }
    }
  });
  return lines.join("\n");
}
function table(value: Node): string {
  const rows = children(value).map(row => children(row).map(cell => blocks(children(cell), "").replaceAll("\n", " ").replaceAll("|", "\\|"))).filter(row => row.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map(row => row.length));
  const line = (row: string[]) => `| ${[...row, ...Array<string>(width - row.length).fill("")].join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
}
function block(value: Node, indent: string): string {
  switch (type(value)) {
    case "paragraph": return inline(children(value));
    case "heading": return `${"#".repeat(Math.max(1, Math.min(6, Number(attr(value, "level")) || 1)))} ${inline(children(value))}`;
    case "bulletList": return list(value, indent);
    case "orderedList": return list(value, indent, Number(attr(value, "order")) || 1);
    case "codeBlock": return `\`\`\`${textAttr(value, "language")}\n${children(value).map(child => typeof child.text === "string" ? child.text : "").join("")}\n\`\`\``;
    case "blockquote": case "panel": return blocks(children(value), indent).split("\n").map(line => `> ${line}`).join("\n");
    case "rule": return "---";
    case "table": return table(value);
    case "mediaSingle": case "mediaGroup": case "media": return "";
    default: return children(value).length ? blocks(children(value), indent) : inline([value]);
  }
}
export function jiraRichText(value: unknown): string {
  return typeof value === "string" ? value.trim() : blocks(children(value), "").trim();
}
export function textToAdf(text: string): unknown {
  return { type: "doc", version: 1, content: text.replaceAll("\r\n", "\n").split("\n\n").map(value => value.trim()).filter(Boolean).map(paragraph => ({
    type: "paragraph", content: paragraph.split("\n").flatMap((line, index) => [
      ...(index ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : []),
    ]),
  })) };
}
