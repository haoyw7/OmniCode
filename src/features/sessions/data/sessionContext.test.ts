import { describe, expect, it, vi } from "vitest";
import { getSession, persistFingerprint } from "./sessionStore";
import { invoke } from "@tauri-apps/api/core";
import { newSession } from "../model/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));
const breakdown = { used: 500, window: 1000, updatedAt: 1234, estimated: true,
  categories: [{ name: "Messages", tokens: 500, kind: "used" as const }] };

describe("stored context details", () => {
  it("restores optional categories and preserves aggregate-only legacy records", async () => {
    const record = { ...newSession("claude", "/repo"), contextUsed: 500, contextWindow: 1000 };
    vi.mocked(invoke).mockResolvedValue({ ...record, contextBreakdown: breakdown });
    expect((await getSession(record.id))?.context).toEqual({ used: 500, window: 1000, breakdown });
    vi.mocked(invoke).mockResolvedValue(record);
    expect((await getSession(record.id))?.context).toEqual({ used: 500, window: 1000 });
    for (const contextBreakdown of [{}, { ...breakdown, categories: [null] }, { ...breakdown, window: 2000 }]) {
      vi.mocked(invoke).mockResolvedValue({ ...record, contextBreakdown });
      expect((await getSession(record.id))?.context?.breakdown).toBeUndefined();
    }
  });

  it("saves a new snapshot even when the aggregate has not changed", () => {
    const session = { ...newSession("claude", "/repo"), context: { used: 500, window: 1000, breakdown } };
    const fingerprint = persistFingerprint(session);
    expect(fingerprint).toContain('"contextBreakdown"');
    expect(persistFingerprint({ ...session, context: { ...session.context, breakdown: { ...breakdown, updatedAt: 2345 } } })).not.toBe(fingerprint);
  });
});
