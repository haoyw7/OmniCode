import { describe, expect, it } from "vitest";
import { newSession } from "./session";
import {
  applyNativeTitle,
  applyGeneratedTitle,
  beginTitleCycle,
  manualSessionTitle,
  titleStateFor,
} from "./titlePolicy";

describe("title ownership", () => {
  it("protects legacy names and explicit renames, even if identical to the temporary title", () => {
    const legacy = {
      ...newSession("codex"),
      title: "My title",
      titleState: undefined,
    };
    expect(titleStateFor(legacy).source).toBe("manual");
    const session = manualSessionTitle(
      { ...newSession("codex"), providerSessionId: "native" },
      "codex",
    );
    expect(applyNativeTitle(session, "native", "Generated native name")).toBe(
      session,
    );
  });
  it("accepts a late native title over the initial fallback but rejects other native IDs", () => {
    const session = beginTitleCycle({
      ...newSession("codex"),
      providerSessionId: "native",
    });
    const generated = applyGeneratedTitle(
      session,
      session.titleState!.epoch,
      "Fallback title",
    );
    expect(applyNativeTitle(generated, "other", "Wrong title")).toBe(generated);
    expect(applyNativeTitle(generated, "native", "原生标题").title).toBe(
      "codex · 原生标题",
    );
  });
  it("rejects stale generation and default native names", () => {
    const session = beginTitleCycle({
      ...newSession("antigravity"),
      providerSessionId: "native",
    });
    expect(
      applyNativeTitle(
        session,
        "native",
        "Session 123e4567-e89b-12d3-a456-426614174000",
      ),
    ).toBe(session);
    expect(
      applyGeneratedTitle(
        session,
        session.titleState!.epoch - 1,
        "Stale title",
      ),
    ).toBe(session);
  });
  it("keeps an automation refresh authoritative against old native titles", () => {
    const session = beginTitleCycle(
      { ...newSession("codex"), providerSessionId: "native" },
      true,
    );
    const refreshed = applyGeneratedTitle(
      session,
      session.titleState!.epoch,
      "New event goal",
    );
    expect(applyNativeTitle(refreshed, "native", "Old native goal")).toBe(
      refreshed,
    );
    expect(
      beginTitleCycle(manualSessionTitle(session, "Manual"), true).titleState!
        .source,
    ).toBe("manual");
  });
});
