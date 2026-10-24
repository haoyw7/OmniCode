import { describe, expect, it } from "vitest";
import { REMOTE_PROVIDERS } from "../contracts/provider";
import { type HostModelCatalog } from "../contracts/protocol";
import { newSession } from "../features/sessions/model/session";
import { mobileContextUsage } from "./contextUsage";

describe("mobile context usage", () => {
  it("preserves the Host category snapshot for the mobile status card", () => {
    const breakdown = { used: 500, window: 1000, updatedAt: 1234, estimated: true,
      categories: [{ name: "Messages", tokens: 500, kind: "used" as const }] };
    const usage = { used: 500, window: 1000, breakdown };
    expect(mobileContextUsage({ ...newSession("claude", "/repo"), context: usage })).toEqual(usage);
  });
  it.each(REMOTE_PROVIDERS)(
    "uses %s's reported window before its catalog",
    (harness) => {
      const session = {
        ...newSession(harness, "/repo"),
        model: `${harness}:test`,
        context: { used: 50_000, window: 200_000 },
      };
      const catalog: HostModelCatalog = {
        models: {
          [harness]: [
            {
              id: session.model,
              harness,
              name: "Test",
              contextWindow: 100_000,
            },
          ],
        },
        errors: {},
      };
      expect(mobileContextUsage(session, catalog)).toEqual({
        used: 50_000,
        window: 200_000,
      });
    },
  );

  it("fills a missing window from the exact Host model", () => {
    const session = {
      ...newSession("opencode", "/repo"),
      model: "opencode:provider/model",
      context: { used: 25_000 },
    };
    const catalog: HostModelCatalog = {
      models: {
        opencode: [
          {
            id: session.model,
            harness: "opencode",
            name: "Model",
            contextWindow: 100_000,
          },
        ],
      },
      errors: {},
    };
    expect(mobileContextUsage(session, catalog)).toEqual({
      used: 25_000,
      window: 100_000,
    });
    expect(session.context).toEqual({ used: 25_000 });
    expect(
      mobileContextUsage(
        { ...session, model: "opencode:other/model" },
        catalog,
      ),
    ).toEqual({ used: 25_000 });
  });

  it("does not invent usage from a known model window", () => {
    const session = {
      ...newSession("pi", "/repo"),
      model: "pi:provider/model",
    };
    const catalog: HostModelCatalog = {
      models: {
        pi: [
          {
            id: session.model,
            harness: "pi",
            name: "Model",
            contextWindow: 200_000,
          },
        ],
      },
      errors: {},
    };
    expect(mobileContextUsage(session, catalog)).toBeUndefined();
    expect(mobileContextUsage(undefined, catalog)).toBeUndefined();
  });

  it("keeps token-only readings and accepts an explicitly reported zero", () => {
    const session = newSession("claude", "/repo");
    expect(
      mobileContextUsage({ ...session, context: { used: 12_000 } }),
    ).toEqual({ used: 12_000 });
    expect(
      mobileContextUsage({ ...session, context: { used: 0, window: 200_000 } }),
    ).toEqual({ used: 0, window: 200_000 });
  });

  it("rejects invalid counts and ignores invalid windows", () => {
    const session = newSession("claude", "/repo");
    for (const used of [-1, NaN, Infinity])
      expect(
        mobileContextUsage({ ...session, context: { used } }),
      ).toBeUndefined();
    for (const window of [0, -1, NaN, Infinity])
      expect(
        mobileContextUsage({ ...session, context: { used: 5, window } }),
      ).toEqual({ used: 5 });
  });
});
