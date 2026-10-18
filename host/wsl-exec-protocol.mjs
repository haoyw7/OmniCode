import { StringDecoder } from "node:string_decoder";

export const WSL_EXEC_PROTOCOL = 1;
export const MAX_FRAME_BYTES = 96 * 1024 * 1024;

/** Incremental framing avoids rescanning/copying large provider JSON on every chunk. */
export function readLines(input, onLine, onError, maximum = MAX_FRAME_BYTES) {
  const decoder = new StringDecoder("utf8");
  let parts = [], bytes = 0, closed = false;
  const flush = () => {
    const line = parts.join("").replace(/\r$/, "");
    parts = []; bytes = 0;
    onLine(line);
  };
  const push = (value) => {
    if (closed) return;
    for (let start = 0; start < value.length;) {
      const newline = value.indexOf("\n", start);
      const end = newline < 0 ? value.length : newline;
      const part = value.slice(start, end);
      bytes += Buffer.byteLength(part);
      if (bytes > maximum) {
        closed = true; parts = [];
        onError(new Error("WSL execution frame exceeds the output limit"));
        return;
      }
      if (part) parts.push(part);
      if (newline < 0) return;
      flush();
      start = newline + 1;
    }
  };
  const data = (chunk) => push(typeof chunk === "string" ? chunk : decoder.write(chunk));
  const end = () => { push(decoder.end()); if (!closed && parts.length) flush(); closed = true; };
  input.on("data", data);
  input.once("end", end);
  return () => { closed = true; parts = []; input.off("data", data); input.off("end", end); };
}

