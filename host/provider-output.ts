// A 20 MiB image becomes about 27 MiB in a protocol event. Leave room for
// several images and old inline-image history without unbounded buffering.
export const MAX_PROVIDER_OUTPUT_BYTES = 64 * 1024 * 1024;
export const MAX_PROVIDER_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;

/** Collect a frame once, rather than repeatedly copying and scanning a large
 * partial JSON line. A failed stream never emits the discarded frame's tail. */
export class ProviderOutputReader {
  private parts: string[] = [];
  private bytes = 0;
  private closed = false;

  constructor(
    private readonly maxBytes: number,
    private readonly onLine: (line: string) => void,
    private readonly onOverflow: () => void,
  ) {}

  push(data: string): void {
    if (this.closed) return;
    let start = 0;
    while (start < data.length) {
      const newline = data.indexOf("\n", start);
      const end = newline < 0 ? data.length : newline;
      const part = data.slice(start, end);
      this.bytes += Buffer.byteLength(part, "utf8");
      if (this.bytes > this.maxBytes) {
        this.closed = true;
        this.parts = [];
        this.bytes = 0;
        this.onOverflow();
        return;
      }
      if (part) this.parts.push(part);
      if (newline < 0) return;
      this.flush();
      start = newline + 1;
    }
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.parts.length) this.flush();
  }

  private flush(): void {
    const line = this.parts.join("").replace(/\r$/, "");
    this.parts = [];
    this.bytes = 0;
    this.onLine(line);
  }
}
