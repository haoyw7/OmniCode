import { describe, expect, it, vi } from "vitest";
import { commitCoAuthors, contributorAvatarUrl } from "./gitContributors";

describe("commit contributors", () => {
  it("preserves names and emails, deduplicates trailers and ignores empty names", () => {
    expect(commitCoAuthors([
      "Message mentioning Co-authored-by: not a trailer",
      "Co-authored-by: Ada Lovelace <Ada@example.test>",
      "co-authored-by: Ada <ada@example.test>",
      "Co-authored-by: 王小明",
      "Co-authored-by: <empty@example.test>",
    ].join("\n"))).toEqual([
      { name: "Ada Lovelace", email: "Ada@example.test" },
      { name: "王小明", email: undefined },
    ]);
    expect(commitCoAuthors()).toEqual([]);
  });

  it("resolves both GitHub no-reply formats without treating display names as logins", async () => {
    expect(await contributorAvatarUrl(" 123+Octocat@users.noreply.github.com "))
      .toBe("https://avatars.githubusercontent.com/u/123?s=64");
    expect(await contributorAvatarUrl("octocat@users.noreply.github.com"))
      .toBe("https://avatars.githubusercontent.com/octocat?s=64");
    expect(await contributorAvatarUrl()).toBe("");
  });

  it("uses a normalized SHA-256 email hash for Gravatar", async () => {
    expect(await contributorAvatarUrl(" MyEmailAddress@example.com "))
      .toBe("https://www.gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?s=64&d=404");
  });

  it("keeps placeholders usable when Web Crypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(await contributorAvatarUrl("ada@example.test")).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
