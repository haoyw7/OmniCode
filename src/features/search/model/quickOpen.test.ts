import { beforeEach, describe, expect, it } from "vitest";
import { translate } from "../../../shared/i18n/language";
import {
  loadRecentCommands,
  parseQuickOpenQuery,
  quickOpenQueryFor,
  rankCommands,
  rankProjects,
  rankSessions,
  rememberCommand,
} from "./quickOpen";

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

describe("parseQuickOpenQuery", () => {
  it("picks the mode from a leading prefix only", () => {
    expect(parseQuickOpenQuery("App.tsx")).toEqual({
      mode: "files",
      query: "App.tsx",
    });
    expect(parseQuickOpenQuery("> split")).toEqual({
      mode: "commands",
      query: "split",
    });
    expect(parseQuickOpenQuery("#login")).toEqual({
      mode: "sessions",
      query: "login",
    });
    expect(parseQuickOpenQuery(" @repo")).toEqual({
      mode: "projects",
      query: "repo",
    });
    expect(parseQuickOpenQuery("a>b").mode).toBe("files");
  });

  it("swaps the prefix while keeping the typed text", () => {
    expect(quickOpenQueryFor("sessions", "> split")).toBe("#split");
    expect(quickOpenQueryFor("files", "@repo")).toBe("repo");
    expect(quickOpenQueryFor("commands", "parser")).toBe(">parser");
  });
});

describe("rankCommands", () => {
  const commands = [
    { id: "Pane: Split Right", title: "Split Right" },
    { id: "View: Reload", title: "Reload" },
    { id: "App: Settings", title: "Settings…" },
  ];

  it("keeps registry order with recent commands first when empty", () => {
    const ids = rankCommands(commands, "", (text) => text, ["App: Settings"]).map(
      (command) => command.id,
    );
    expect(ids).toEqual(["App: Settings", "Pane: Split Right", "View: Reload"]);
  });

  it("matches Chinese labels and still finds English ids", () => {
    const zh = (text: string) => translate(text, undefined, "zh-CN");
    const byChinese = rankCommands(commands, "分栏", zh);
    expect(byChinese.map((command) => command.id)).toEqual([
      "Pane: Split Right",
    ]);
    expect(byChinese[0].label).toBe("面板：向右分栏");
    expect(byChinese[0].positions.length).toBeGreaterThan(0);

    const byEnglish = rankCommands(commands, "reload", zh);
    expect(byEnglish.map((command) => command.id)).toEqual(["View: Reload"]);
    expect(byEnglish[0].positions).toEqual([]);
  });
});

describe("recent commands", () => {
  it("keeps the eight most recent distinct ids", () => {
    for (let index = 0; index < 10; index++) rememberCommand(`C${index}`);
    rememberCommand("C5");
    expect(loadRecentCommands()).toEqual([
      "C5",
      "C9",
      "C8",
      "C7",
      "C6",
      "C4",
      "C3",
      "C2",
    ]);
  });

  it("ignores unreadable storage", () => {
    localStorage.setItem("monocode.quickOpen.recentCommands", "{");
    expect(loadRecentCommands()).toEqual([]);
  });
});

describe("rankSessions", () => {
  const rows = [
    { id: "a", cwd: "/other", harness: "claude" as const, title: "Alpha", updatedAt: 30 },
    { id: "b", cwd: "/repo", harness: "claude" as const, title: "Beta", updatedAt: 10 },
    { id: "c", cwd: "/repo", harness: "claude" as const, title: "Gamma", updatedAt: 20 },
  ];

  it("leads with the current project when there is no query", () => {
    expect(rankSessions(rows, "", "/repo").map((hit) => hit.sessionId)).toEqual(
      ["c", "b", "a"],
    );
    expect(rankSessions(rows, "", null).map((hit) => hit.sessionId)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("searches titles across projects", () => {
    expect(
      rankSessions(rows, "alp", "/repo").map((hit) => hit.sessionId),
    ).toEqual(["a"]);
  });
});

describe("rankProjects", () => {
  const recents = [
    { path: "/work/alpha", openedAt: 1 },
    { path: "/work/beta", openedAt: 5 },
  ];

  it("orders by recency without a query and by match with one", () => {
    expect(rankProjects(recents, "").map((hit) => hit.name)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(rankProjects(recents, "alp").map((hit) => hit.path)).toEqual([
      "/work/alpha",
    ]);
  });
});
