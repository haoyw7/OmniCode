import { describe, expect, it, vi } from "vitest";
import { ProviderOutputReader } from "./provider-output";

describe("provider output framing", () => {
  it("limits each frame rather than a chunk containing many frames", () => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const reader = new ProviderOutputReader(5, line => lines.push(line), overflow);
    reader.push("abc\r");
    reader.push("\ndef\n\ntail");
    reader.end();
    reader.end();
    expect(lines).toEqual(["abc", "def", "", "tail"]);
    expect(overflow).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes and accepts a frame exactly at the limit", () => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const reader = new ProviderOutputReader(6, line => lines.push(line), overflow);
    reader.push("你好\n");
    reader.push("你");
    reader.push("好啊\n");
    expect(lines).toEqual(["你好"]);
    expect(overflow).toHaveBeenCalledOnce();
  });

  it.each(["012345\nsuffix\n", "012345"])("discards all output after an oversized frame: %j", data => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const reader = new ProviderOutputReader(5, line => lines.push(line), overflow);
    reader.push("ok\n");
    reader.push(data);
    reader.push("truncated-tail\nnext\n");
    reader.end();
    expect(lines).toEqual(["ok"]);
    expect(overflow).toHaveBeenCalledOnce();
  });
});
