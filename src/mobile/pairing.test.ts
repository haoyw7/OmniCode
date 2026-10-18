import { describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import qrcode from "qrcode-generator";
import { pairingHostUrl, pairingLink } from "../features/connections/model/pairingLink";
import { normalizePairingCode, parsePairingOffer } from "./pairing";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { post: vi.fn() },
}));

describe("pairing QR codes", () => {
  it("reads the Host URL and pairing code", () => {
    expect(
      parsePairingOffer("omnicode://pair?host=http%3A%2F%2F192.168.0.206%3A3774%2F&token=abc_-1"),
    ).toEqual({ host: "http://192.168.0.206:3774", token: "abc_-1" });
  });

  it("normalizes typed pairing codes without changing long device tokens", () => {
    expect(normalizePairingCode(" xd5j2j3u ")).toBe("XD5J-2J3U");
    expect(normalizePairingCode("xd5j-2j3u")).toBe("XD5J-2J3U");
    expect(normalizePairingCode("aB3_long-device-token")).toBe("aB3_long-device-token");
    expect(parsePairingOffer("omnicode://pair?host=http://pc:3774&token=XD5J-2J3U").token).toBe("XD5J-2J3U");
  });

  it("rejects unrelated QR codes and Host URLs with paths", () => {
    expect(() => parsePairingOffer("https://example.com/?host=http://pc&token=abc")).toThrow("not a OmniCode pairing code");
    expect(() => parsePairingOffer("omnicode://pair?token=abc")).toThrow("not a OmniCode pairing code");
    expect(() => parsePairingOffer("omnicode://pair?host=http://pc&token=a%20b")).toThrow("valid device token");
    expect(() => parsePairingOffer("omnicode://pair?host=http://pc/rpc&token=abc")).toThrow("Host URL only");
  });
});

describe("desktop pairing QR codes", () => {
  it("decode on mobile to the Host URL and pairing code", () => {
    const host = pairingHostUrl(" http://192.168.0.206:3774/ ")!;
    const code = qrcode(0, "M");
    code.addData(pairingLink(host, "XD5J-2J3U"));
    code.make();
    const scale = 4, quiet = 4, count = code.getModuleCount(), size = (count + quiet * 2) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const row = Math.floor(y / scale) - quiet, col = Math.floor(x / scale) - quiet;
        if (row >= 0 && col >= 0 && row < count && col < count && code.isDark(row, col))
          pixels.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
      }
    const text = jsQR(pixels, size, size)!.data;
    expect(parsePairingOffer(text)).toEqual({ host: "http://192.168.0.206:3774", token: "XD5J-2J3U" });
  });

  it("only offers a QR code for an origin-only Host URL", () => {
    expect(pairingHostUrl("https://pc.example.ts.net")).toBe("https://pc.example.ts.net");
    expect(pairingHostUrl("http://pc:3774/rpc")).toBeUndefined();
    expect(pairingHostUrl("192.168.0.206:3774")).toBeUndefined();
  });
});
