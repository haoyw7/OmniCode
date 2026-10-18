import { describe, expect, it } from "vitest";
import {
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
