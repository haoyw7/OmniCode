// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  newProviderAccount,
  providerAccountLabel,
  providerAccountExists,
  providerAccounts,
  removeProviderAccount,
  renameProviderAccount,
  saveProviderAccount,
  selectedProviderAccountId,
  selectProviderAccount,
  rememberSharedProviderDefaults,
  requestedProviderAccountId,
  restoreProviderAccounts,
} from "./providerAccounts";

beforeEach(() => {
  localStorage.clear();
});

describe("provider accounts", () => {
  it("always exposes the provider-owned default account", () => {
    expect(providerAccounts("claude")).toEqual([
      {
        id: DEFAULT_PROVIDER_ACCOUNT_ID,
        provider: "claude",
        label: "Default account",
        isDefault: true,
      },
    ]);
  });

  it("edits the built-in Home, preserves it on rename and can reset it without deleting the profile", () => {
    saveProviderAccount({ id: "default", provider: "codex", label: "Default account", dataHome: "/data/codex" });
    expect(providerAccounts("codex")[0]).toMatchObject({ dataHome: "/data/codex", isDefault: true });
    renameProviderAccount("codex", "default", "Primary");
    expect(providerAccounts("codex")[0]).toMatchObject({ label: "Primary", dataHome: "/data/codex" });
    restoreProviderAccounts({ codex: [{ id: "default", label: "Primary", dataHome: "/data/codex", resolvedDataHome: "/data/codex" }] });
    expect(providerAccounts("codex")[0]).not.toHaveProperty("resolvedDataHome");
    expect(removeProviderAccount("codex", "default")).toBe(false);
    saveProviderAccount({ id: "default", provider: "codex", label: "Primary" });
    expect(providerAccounts("codex")[0]).not.toHaveProperty("dataHome");
    expect(providerAccounts("claude")[0]).not.toHaveProperty("dataHome");
  });

  it("stores named profiles separately per provider", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    const work = newProviderAccount("claude", "  Work   account  ");
    saveProviderAccount(work);

    expect(providerAccounts("claude").map((account) => account.label)).toEqual([
      "Default account",
      "Work account",
    ]);
    expect(providerAccounts("codex")).toHaveLength(1);
    expect(providerAccountLabel("claude", work.id)).toBe("Work account");
  });

  it("falls back to the default account for malformed stored profiles", () => {
    localStorage.setItem(
      "monocode.providerAccounts.v1",
      JSON.stringify({ claude: { id: "not-an-array" } }),
    );

    expect(providerAccounts("claude").map((account) => account.id)).toEqual([
      DEFAULT_PROVIDER_ACCOUNT_ID,
    ]);
  });

  it("falls back when the stored root is not a record", () => {
    for (const malformed of ["null", "[]", "42"]) {
      localStorage.setItem("monocode.providerAccounts.v1", malformed);
      expect(providerAccounts("claude").map((account) => account.id)).toEqual([
        DEFAULT_PROVIDER_ACCOUNT_ID,
      ]);
    }

    localStorage.setItem("monocode.providerAccountSelections.v1", "null");
    expect(selectedProviderAccountId("claude", "/repo")).toBe(
      DEFAULT_PROVIDER_ACCOUNT_ID,
    );
  });

  it("replaces malformed provider storage when saving an account", () => {
    localStorage.setItem(
      "monocode.providerAccounts.v1",
      JSON.stringify({ codex: "not-an-array" }),
    );

    expect(() =>
      saveProviderAccount({
        id: "account-work",
        provider: "codex",
        label: "Work",
      }),
    ).not.toThrow();
    expect(providerAccounts("codex").map((account) => account.label)).toEqual([
      "Default account",
      "Work",
    ]);
  });

  it("discards malformed account entries when saving an account", () => {
    localStorage.setItem(
      "monocode.providerAccounts.v1",
      JSON.stringify({
        codex: [
          null,
          42,
          { id: "account-missing-label", provider: "codex" },
          { id: "account-keep", provider: "codex", label: "Keep" },
        ],
      }),
    );

    expect(() =>
      saveProviderAccount({
        id: "account-work",
        provider: "codex",
        label: "Work",
      }),
    ).not.toThrow();
    expect(providerAccounts("codex").map((account) => account.label)).toEqual([
      "Default account",
      "Keep",
      "Work",
    ]);
  });

  it("replaces stale account metadata with Host rows without persisting credential Home paths", () => {
    saveProviderAccount({ id: "removed", provider: "codex", label: "Removed", dataHome: "/local" });
    restoreProviderAccounts({ codex: [{ id: "work", label: "Host profile", dataHome: "/private" }] });
    expect(providerAccounts("codex")).toEqual([
      { id: "default", provider: "codex", label: "Default account", isDefault: true },
      { id: "work", provider: "codex", label: "Host profile" },
    ]);
    renameProviderAccount("codex", "work", "Stale local label");
    restoreProviderAccounts({ codex: [{ id: "work", label: "Host rename" }] });
    expect(providerAccounts("codex")[1].label).toBe("Host rename");
    restoreProviderAccounts({});
    expect(providerAccounts("codex")).toHaveLength(1);
  });

  it("reports failed account storage instead of pretending the account was added", () => {
    const storage = localStorage;
    vi.stubGlobal("localStorage", { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error("full"); } });
    try {
      expect(() => saveProviderAccount({ id: "work", provider: "codex", label: "Work" })).toThrow("Browser storage is unavailable");
      expect(providerAccounts("codex")).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("remembers a selection per project and ignores unknown ids", () => {
    const work = {
      id: "account-work",
      provider: "codex" as const,
      label: "Work",
    };
    saveProviderAccount(work);
    selectProviderAccount("codex", "/repo/one", work.id);

    expect(selectedProviderAccountId("codex", "/repo/one")).toBe(work.id);
    expect(selectedProviderAccountId("codex", "/repo/two")).toBe(
      DEFAULT_PROVIDER_ACCOUNT_ID,
    );
    selectProviderAccount("codex", "/repo/one", "missing");
    expect(selectedProviderAccountId("codex", "/repo/one")).toBe(work.id);
  });

  it("renames a named account without changing its identity or order", () => {
    saveProviderAccount({
      id: "account-work",
      provider: "codex",
      label: "Wrk",
    });
    saveProviderAccount({
      id: "account-personal",
      provider: "codex",
      label: "Personal",
    });

    expect(
      renameProviderAccount("codex", "account-work", "  Work   account  "),
    ).toEqual({
      id: "account-work",
      provider: "codex",
      label: "Work account",
    });
    expect(providerAccounts("codex").map((account) => account.id)).toEqual([
      DEFAULT_PROVIDER_ACCOUNT_ID,
      "account-work",
      "account-personal",
    ]);
  });

  it("removes named account metadata and every project selection", () => {
    const work = {
      id: "account-work",
      provider: "claude" as const,
      label: "Work",
    };
    saveProviderAccount(work);
    selectProviderAccount("claude", "/repo/one", work.id);
    selectProviderAccount("claude", "/repo/two", work.id);

    expect(removeProviderAccount("claude", work.id)).toBe(true);
    expect(providerAccountExists("claude", work.id)).toBe(false);
    expect(selectedProviderAccountId("claude", "/repo/one")).toBe(
      DEFAULT_PROVIDER_ACCOUNT_ID,
    );
    expect(selectedProviderAccountId("claude", "/repo/two")).toBe(
      DEFAULT_PROVIDER_ACCOUNT_ID,
    );
  });

  it("renames but does not remove the provider-owned default account", () => {
    expect(renameProviderAccount("codex", "default", "  Personal  ")).toEqual({
      id: DEFAULT_PROVIDER_ACCOUNT_ID,
      provider: "codex",
      label: "Personal",
      isDefault: true,
    });
    expect(removeProviderAccount("codex", "default")).toBe(false);
    expect(providerAccounts("codex")[0]?.label).toBe("Personal");
  });

  it("preserves a custom default name when named profiles change", () => {
    renameProviderAccount("claude", "default", "Primary");
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    removeProviderAccount("claude", "account-work");

    expect(providerAccounts("claude")[0]?.label).toBe("Primary");
  });
});

it("uses confirmed shared defaults for new selections, keeps explicit overrides and exposes missing defaults", () => {
  rememberSharedProviderDefaults({ codex: "account-9300" });
  expect(selectedProviderAccountId("codex", "/repo")).toBe("account-9300");
  expect(requestedProviderAccountId("codex", "/repo")).toBeUndefined();
  saveProviderAccount({ provider: "codex", id: "work", label: "Work" });
  selectProviderAccount("codex", "/repo", "work");
  rememberSharedProviderDefaults({ codex: "removed" });
  expect(selectedProviderAccountId("codex", "/repo")).toBe("work");
  expect(selectedProviderAccountId("codex", "/different")).toBe("removed");
  selectProviderAccount("codex", "/repo", "default");
  expect(selectedProviderAccountId("codex", "/repo")).toBe("default");
});

it("clears selections even when Host hydration removed the account first", () => {
  saveProviderAccount({ provider: "codex", id: "work", label: "Work" });
  selectProviderAccount("codex", "/repo", "work");
  restoreProviderAccounts({});
  expect(removeProviderAccount("codex", "work")).toBe(false);
  expect(selectedProviderAccountId("codex", "/repo")).toBe("default");
});
