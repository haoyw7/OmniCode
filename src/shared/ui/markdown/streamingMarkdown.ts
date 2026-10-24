import remend from "remend";
import { parseMarkdownIntoBlocks } from "streamdown";

export function isFenceBlock(content: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})/.test(content);
}

function repair(block: string): string {
  return isFenceBlock(block) ? block : remend(block);
}

export function parseStreamingMarkdown(text: string): string[] {
  return parseMarkdownIntoBlocks(text).map(repair);
}

/** Keep the ambiguous tail open; stable blocks never pass through the lexer again. */
export class StreamingMarkdownParser {
  committed: readonly string[] = [];
  frontier: readonly string[] = [];
  buffer = "";
  offsets: number[] = [];
  private source = "";
  private committedLength = 0;
  private result: string[] = [];
  private hasDefinitions = false;
  private definitionState: "indent" | "label-start" | "label" | "colon" | "invalid" = "indent";
  private definitionIndent = 0;

  private scanDefinitions(delta: string) {
    for (let index = 0; index < delta.length; index++) {
      const character = delta[index];
      if (character === "\n") {
        this.definitionState = "indent";
        this.definitionIndent = 0;
      } else if (this.definitionState === "indent") {
        if (character === " " && this.definitionIndent < 3) this.definitionIndent++;
        else this.definitionState = character === "[" ? "label-start" : "invalid";
      } else if (this.definitionState === "label-start") {
        this.definitionState = character === "]" ? "invalid" : "label";
      } else if (this.definitionState === "label") {
        if (character === "]") this.definitionState = "colon";
      } else if (this.definitionState === "colon") {
        if (character === ":") {
          this.hasDefinitions = true;
          return;
        }
        this.definitionState = "invalid";
      } else {
        const newline = delta.indexOf("\n", index);
        if (newline < 0) return;
        index = newline - 1;
      }
    }
  }

  advance(delta: string): string[] {
    if (!delta) return this.result;
    if (!this.hasDefinitions) this.scanDefinitions(delta);
    this.source += delta;
    this.buffer += delta;
    // Definitions can change references anywhere in the document. Streamdown
    // intentionally renders these as one block, including forward references.
    if (this.hasDefinitions) {
      this.committed = [];
      this.committedLength = 0;
      this.buffer = this.source;
      this.frontier = parseStreamingMarkdown(this.source);
      this.offsets = [0];
      return (this.result = [...this.frontier]);
    }
    const raw = parseMarkdownIntoBlocks(this.buffer);
    // Retain two substantive blocks: a partial following marker can still
    // become a list continuation, setext heading, table delimiter or fence.
    let retain = 2;
    let boundary = raw.length;
    while (boundary > 0 && retain > 0) {
      boundary--;
      if (raw[boundary].trim()) retain--;
    }
    // The lexer normalizes some inputs (e.g. CRLF). Do not use normalized
    // lengths as source offsets; leave that tail uncommitted instead.
    if (raw.join("") !== this.buffer) boundary = 0;
    const parsed = raw.map(repair);
    const starts = this.offsets.slice(0, this.committed.length);
    let offset = this.committedLength;
    for (const block of raw) {
      starts.push(offset);
      offset += block.length;
    }
    this.offsets = starts;
    if (boundary > 0) {
      const length = raw.slice(0, boundary).join("").length;
      this.committed = [...this.committed, ...parsed.slice(0, boundary)];
      this.committedLength += length;
      this.buffer = this.buffer.slice(length);
    }
    this.frontier = parsed.slice(boundary);
    return (this.result = [...this.committed, ...this.frontier]);
  }

  parse = (text: string): string[] => {
    if (!text.startsWith(this.source)) {
      this.source = "";
      this.buffer = "";
      this.committed = [];
      this.frontier = [];
      this.committedLength = 0;
      this.offsets = [];
      this.result = [];
      this.hasDefinitions = false;
      this.definitionState = "indent";
      this.definitionIndent = 0;
    }
    return this.advance(text.slice(this.source.length));
  };
}
