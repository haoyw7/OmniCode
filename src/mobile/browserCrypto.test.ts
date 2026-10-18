import { describe, expect, it, vi } from "vitest";
import { ensureRandomUUID } from "./browserCrypto";

describe("LAN HTTP UUID support", () => {
  it("preserves the platform UUID method when it is available", () => {
    const native = vi.fn(() => "01234567-89ab-4cde-8fab-0123456789ab");
    const getRandomValues = vi.fn();
    const api = { randomUUID: native, getRandomValues } as unknown as Crypto;
    ensureRandomUUID(api);
    expect(api.randomUUID).toBe(native);
    expect(api.randomUUID()).toBe("01234567-89ab-4cde-8fab-0123456789ab");
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("uses 16 cryptographic bytes and sets UUID v4 version and variant bits", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    const api = { getRandomValues } as unknown as Crypto;
    ensureRandomUUID(api);
    expect(api.randomUUID()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
    const installed = api.randomUUID;
    ensureRandomUUID(api);
    expect(api.randomUUID).toBe(installed);
  });
});
