import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  decodeGeneratedImage,
  decodeGeneratedPng,
  MAX_GENERATED_IMAGE_BYTES,
} from "./generatedImage";

export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

describe("bounded generated PNG data", () => {
  it("accepts base64 and the existing Codex PNG data URL", () => {
    expect(decodeGeneratedPng(PNG).slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(decodeGeneratedPng(`data:image/png;base64,${PNG}`)).toEqual(
      decodeGeneratedPng(PNG),
    );
  });
  it.each(["", "not-base64", "AAAA", "data:image/jpeg;base64,AAAA"])(
    "rejects malformed PNG %j",
    (data) => {
      expect(() => decodeGeneratedPng(data)).toThrow();
    },
  );
  it("rejects oversized data before decoding it", () => {
    expect(() =>
      decodeGeneratedPng(
        "A".repeat(Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 + 4),
      ),
    ).toThrow("20 MiB");
  });
  it("rejects corruption in a PNG's data chunk", () => {
    const bytes = Buffer.from(PNG, "base64");
    bytes[45] ^= 1;
    expect(() => decodeGeneratedPng(bytes.toString("base64"))).toThrow(
      "checksum",
    );
  });
});

describe("native generated image formats", () => {
  it.each([["jpeg", "generated-red.jpg.b64"], ["webp", "generated-pixel.webp.b64"]])("preserves %s bytes and rejects a mismatched MIME type or truncated file", (format, file) => {
    const encoded = readFileSync(new URL(`../../../../tests/fixtures/${file}`, import.meta.url), "utf8").trim();
    const bytes = decodeGeneratedImage(encoded, `image/${format}`);
    expect(Buffer.from(bytes).toString("base64")).toBe(encoded);
    expect(decodeGeneratedImage(`data:image/${format};base64,${encoded}`, `image/${format}`)).toEqual(bytes);
    expect(() => decodeGeneratedImage(encoded, format === "jpeg" ? "image/webp" : "image/jpeg")).toThrow();
    expect(() => decodeGeneratedImage(Buffer.from(bytes.slice(0, 20)).toString("base64"), `image/${format}`)).toThrow();
  });
});
