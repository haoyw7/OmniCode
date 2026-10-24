/** JSON configuration with comments and trailing commas, without evaluating code. */
export function parseJsonc(raw: string): unknown {
  let text = "", quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      text += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; text += char; }
    else if (char === "/" && raw[i + 1] === "/") {
      while (i + 1 < raw.length && raw[i + 1] !== "\n") i++;
      text += " ";
    } else if (char === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unclosed JSON configuration comment");
      text += " "; i = end + 1;
    } else text += char;
  }
  let normalized = "";
  quoted = false; escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; normalized += char; }
    else if (char !== "," || !/^\s*[}\]]/.test(text.slice(i + 1))) normalized += char;
  }
  return JSON.parse(normalized);
}
