import { expect, it } from "vitest";
import {
  MEMORY_MAX_LINES,
  memoryDate,
  memoryWithinBudget,
  addMemoryEntry,
  archiveMemoryEntries,
  fitMemoryBudget,
  memoryEntry,
  memoryLines,
  withLineEdited,
  withoutLine,
  redactSecrets,
  removeMemoryEntry,
  searchMemory,
  sinceDate,
  supersedeMemoryEntry,
  topicName,
  validMemoryName,
} from "./memory";
import { tokenizeMemorySearch } from "./memorySearch";

it("writes one dated line per fact, with an optional end date", () => {
  expect(memoryEntry("  releases run\nfrom a v* tag ", "2026-10-04")).toBe(
    "- 2026-10-04 · releases run from a v* tag",
  );
  expect(memoryEntry("beta is open", "2026-10-04", "2026-11-01")).toBe(
    "- 2026-10-04 · beta is open · until 2026-11-01",
  );
  expect(() => memoryEntry("   ", "2026-10-04")).toThrow("empty");
  expect(() => memoryEntry("x", "2026-10-04", "next week")).toThrow("until");
  expect(() => memoryEntry("x".repeat(1001), "2026-10-04")).toThrow("under");
});

it("keeps credentials out of memory", () => {
  const text = redactSecrets(
    "deploy key ghp_abcdefghijklmnopqrstuvwxyz0123 and password: hunter22",
  );
  expect(text).not.toContain("ghp_abc");
  expect(text).not.toContain("hunter22");
  expect(text).toContain("«redacted");
  expect(redactSecrets("the token budget is 4k")).toBe(
    "the token budget is 4k",
  );
});

it("does not add a fact it already holds", () => {
  const once = addMemoryEntry("", "- 2026-10-01 · uses pnpm");
  expect(once).toEqual({ text: "- 2026-10-01 · uses pnpm\n", added: true });
  expect(addMemoryEntry(once.text, "- 2026-10-04 · uses pnpm").added).toBe(
    false,
  );
});

it("strikes a changed fact through instead of deleting it", () => {
  const text = "My notes\n- 2026-10-01 · CI runs on Travis\n";
  expect(
    supersedeMemoryEntry(
      text,
      "Travis",
      "- 2026-10-04 · CI runs on GitHub Actions",
      "2026-10-04",
    ),
  ).toBe(
    "My notes\n- ~~2026-10-01 · CI runs on Travis~~ · superseded 2026-10-04\n- 2026-10-04 · CI runs on GitHub Actions\n",
  );
});

it("changes only the one entry the text names", () => {
  const text =
    "- 2026-10-01 · api on port 3000\n- 2026-10-01 · web on port 3001\n";
  expect(() => removeMemoryEntry(text, "port")).toThrow("2 entries");
  expect(() => removeMemoryEntry(text, "nothing")).toThrow("No memory entry");
  expect(removeMemoryEntry(text, "web on")).toEqual({
    text: "- 2026-10-01 · api on port 3000\n",
    removed: "- 2026-10-01 · web on port 3001",
  });
});

it("archives struck, then expired, then oldest entries, never the user's own", () => {
  const filler = Array.from(
    { length: MEMORY_MAX_LINES - 2 },
    (_, i) => `- 2026-09-01 · fact ${i}`,
  );
  const text = [
    "User line without a date",
    "- ~~2026-08-01 · old~~ · superseded 2026-09-01",
    "- 2026-08-02 · beta · until 2026-09-30",
    ...filler,
    "- 2026-10-04 · newest",
    "- 2026-10-04 · just written",
  ].join("\n");
  const { text: fitted, moved } = fitMemoryBudget(
    text,
    "- 2026-10-04 · just written",
    "2026-10-04",
  );
  expect(moved).toEqual([
    "- ~~2026-08-01 · old~~ · superseded 2026-09-01",
    "- 2026-08-02 · beta · until 2026-09-30",
    "- 2026-09-01 · fact 0",
  ]);
  expect(fitted.split("\n").filter(Boolean)).toHaveLength(MEMORY_MAX_LINES);
  expect(fitted.startsWith("User line without a date\n")).toBe(true);
  expect(fitted).toContain("just written");
  expect(archiveMemoryEntries("", moved.slice(0, 1), "2026-10-04")).toBe(
    "# Archive\n\n- ~~2026-08-01 · old~~ · superseded 2026-09-01 · moved 2026-10-04\n",
  );
});

it("accepts plain topic names only", () => {
  expect(topicName("releases.md")).toBe("releases");
  expect(topicName(" 发布流程.md ")).toBe("发布流程");
  expect(topicName("-发布_流程")).toBe("-发布_流程");
  expect(topicName("_legacy")).toBe("_legacy");
  expect(topicName("CHAT-DAYS.md")).toBe("CHAT-DAYS");
  for (const name of ["CON", "aux.notes", "name.", "double.md"])
    expect(topicName(`${name}.md`)).toBe(name);
  for (const bad of ["", "../soul", ".hidden", "a/b", "archive", "Archive.md", "a\\b", "中文.", "中文.md.md"])
    expect(() => topicName(bad)).toThrow("topic");
  expect(validMemoryName("中文主题")).toBe(true);
  expect(validMemoryName("tail ")).toBe(false);
});

it("finds entries by their words across files", () => {
  const files = [
    {
      file: "MEMORY.md",
      text: "- 2026-09-01 · releases run from a v* tag\n- 2026-10-02 · the release checklist lives in docs\n",
    },
    {
      file: "memory/people.md",
      text: "# People\n\n- 2026-10-03 · Ana owns the release notes\n",
    },
    {
      file: "memory/archive.md",
      text: "- 2026-01-01 · releases ran from Jenkins · moved 2026-09-01\n",
    },
  ];
  expect(
    searchMemory(files, "Who handles the release?").map((hit) => hit.line).sort(),
  ).toEqual([
    "- 2026-10-03 · Ana owns the release notes",
    "- 2026-10-02 · the release checklist lives in docs",
    "- 2026-09-01 · releases run from a v* tag",
    "- 2026-01-01 · releases ran from Jenkins · moved 2026-09-01",
  ].sort());
  expect(searchMemory(files, "release", { since: "2026-10-01" })).toHaveLength(
    2,
  );
  expect(searchMemory(files, "deploy pipeline")).toEqual([]);
  expect(() => searchMemory(files, "is it")).toThrow("query");
});

it.each([
  ["发布", "topic:deploy"],
  ["发布流程", "topic:deploy"],
  ["项目的发布流程是什么", "topic:deploy"],
  ["飞书", "topic:notifications"],
  ["局域网", "topic:notifications"],
  ["飞书消息推送给谁", "topic:notifications"],
  ["SQLite 保存", "memory"],
  ["ＳＱＬｉｔｅ", "memory"],
  ["CI", "topic:code"],
  ["piFamily.ts", "topic:code"],
  ["family", "topic:code"],
  ["list issues", "topic:code"],
  ["search issues", "topic:code"],
  ["/projects/monocode", "topic:code"],
])("searches Chinese and technical memory with %s", (query, file) => {
  const files = [
    { file: "topic:deploy", text: "- 2026-10-01 · 发布流程使用 GitHub Actions" },
    { file: "topic:notifications", text: "- 2026-10-01 · 飞书消息推送到局域网" },
    { file: "memory", text: "- 2026-10-01 · SQLite 保存会话数据" },
    {
      file: "topic:code",
      text: "- 2026-10-01 · CI 通过 piFamily.ts 调用 listIssues 和 search_issues；项目位于 /projects/monocode。",
    },
  ];
  expect(searchMemory(files, query)[0]?.file).toBe(file);
});

it("does not join Chinese across stop words or punctuation", () => {
  const files = [{ file: "memory", text: "飞的书 飞，书 飞 书 局。域。网" }];
  expect(searchMemory(files, "飞书")).toEqual([]);
  expect(searchMemory(files, "局域网")).toEqual([]);
  for (const query of ["", "！？", "是什么呢", "the and it"])
    expect(() => searchMemory(files, query)).toThrow("searchable word");
});

it("counts repeated words without double counting word and bigram tokens", () => {
  const tokens = tokenizeMemorySearch("发布 发布 issues issues");
  expect(tokens.filter((word) => word === "发布")).toHaveLength(2);
  expect(tokens.filter((word) => word === "issue")).toHaveLength(2);
});

it("ranks rare terms above common matches and allows partial long queries", () => {
  const rare = "- 2026-01-01 · sqlite stores the notebook data";
  const files = [{
    file: "archive",
    text: [
      ...Array.from({ length: 30 }, (_, i) => `- 2026-10-01 · memory display setting group ${i}`),
      rare,
    ].join("\n"),
  }];
  expect(searchMemory(files, "memory sqlite", { limit: 1 })).toEqual([
    { file: "archive", line: rare, date: "2026-01-01" },
  ]);
  expect(searchMemory(files, "sqlite database storage engine", { limit: 1 })[0]?.line).toBe(rare);
  expect(searchMemory(files, "memory memory sqlite")).toEqual(searchMemory(files, "memory sqlite"));
  expect(searchMemory(files, "memory")).toHaveLength(20);
});

it("breaks score ties by date and then source order before applying the limit", () => {
  const files = [
    { file: "memory", text: "- 2026-09-01 · release checklist" },
    { file: "topic:releases", text: "- 2026-10-01 · release checklist" },
    { file: "archive", text: "- ~~2026-10-01 · release checklist~~ · superseded 2026-10-02 · moved 2026-10-03" },
    { file: "topic:undated", text: "release checklist" },
  ];
  expect(searchMemory(files, "release").map((hit) => hit.file)).toEqual([
    "topic:releases", "archive", "memory", "topic:undated",
  ]);
  expect(searchMemory(files, "release", { limit: 2 }).map((hit) => hit.file)).toEqual([
    "topic:releases", "archive",
  ]);
});

it("searches historical facts without scoring their dates or lifecycle markers", () => {
  const history = "  - ~~1901-01-01 · 发布流程使用 Jenkins · until 1901-02-02~~ · superseded 1901-03-03 · moved 1901-04-04  ";
  const expired = "- 1901-01-01 · 发布流程使用 Jenkins · until 1901-02-02 · moved 1901-04-04";
  const files = [{ file: "archive", text: `${history}\n${expired}` }];
  expect(searchMemory(files, "发布流程")).toEqual([
    { file: "archive", line: history, date: "1901-01-01" },
    { file: "archive", line: expired, date: "1901-01-01" },
  ]);
  expect(searchMemory(files, "1901 until moved superseded")).toEqual([]);
  const fact = "- 2026-10-01 · Migration on 2031-11-15 keeps port 5432 until the moved flag clears";
  for (const query of ["2031-11-15", "5432", "until", "moved"])
    expect(searchMemory([{ file: "memory", text: fact }], query)[0]?.line).toBe(fact);
});

it("filters dates before ranking and supports dates without searchable words", () => {
  const old = "- 2026-01-01 · sqlite";
  const recent = "- 2026-10-01 · sqlite stores the notebook data";
  const newest = "- 2026-10-02 · release checklist";
  const files = [{ file: "memory", text: [old, recent, newest, "sqlite undated"].join("\n") }];
  expect(searchMemory(files, "sqlite", { since: "2026-10-01" }).map((hit) => hit.line)).toEqual([recent]);
  for (const query of ["", "是什么呢 the and"])
    expect(searchMemory(files, query, { since: "2026-10-01" }).map((hit) => hit.line)).toEqual([newest, recent]);
  expect(searchMemory(files, "", { since: "2026-10-01", limit: 1 })[0]?.line).toBe(newest);
  expect(searchMemory(files, "sqlite", { since: "2027-01-01" })).toEqual([]);
  expect(searchMemory([], "sqlite")).toEqual([]);
});

it("skips headings and searches resident lines beyond the injection budget", () => {
  const fact = "用户偏好深色主题";
  const text = [
    "# 量子纠缠", "  ## 量子纠缠", "###### 量子纠缠", "",
    ...Array.from({ length: MEMORY_MAX_LINES }, () => "普通记录"),
    fact,
  ].join("\n");
  expect(memoryWithinBudget(text).text).not.toContain(fact);
  expect(searchMemory([{ file: "memory", text }], "深色主题")).toEqual([
    { file: "memory", line: fact },
  ]);
  expect(searchMemory([{ file: "memory", text }], "量子纠缠")).toEqual([]);
});

it("reads since as a date or a span back from today", () => {
  const today = new Date(Date.UTC(2026, 9, 4, 12));
  expect(sinceDate("7d", today, "UTC")).toBe("2026-09-27");
  expect(sinceDate("2026-10-01", today, "UTC")).toBe("2026-10-01");
  expect(() => sinceDate("last week", today, "UTC")).toThrow("since");
});

it("lists memory as facts, whatever wrote them", () => {
  const text = [
    "# Memory",
    "",
    "i am a cool pirate",
    "- 2026-10-04 · The user's name is Nick",
    "- ~~2026-10-01 · CI runs on Travis~~ · superseded 2026-10-04",
    "- 2026-10-04 · beta is open · until 2026-11-01",
  ].join("\n");
  expect(memoryLines(text)).toEqual([
    { index: 2, text: "i am a cool pirate", struck: false },
    {
      index: 3,
      text: "The user's name is Nick",
      struck: false,
      date: "2026-10-04",
    },
    { index: 4, text: "CI runs on Travis", struck: true, date: "2026-10-01" },
    {
      index: 5,
      text: "beta is open",
      struck: false,
      date: "2026-10-04",
      until: "2026-11-01",
    },
  ]);
  expect(withoutLine(text, 2)).not.toContain("pirate");
});

it("rewords a fact in place, keeping its until", () => {
  const text = [
    "i am a cool pirate",
    "- 2026-10-01 · beta is open · until 2026-11-01",
    "",
  ].join("\n");
  expect(withLineEdited(text, 1, "beta is  closed", "2026-10-04")).toBe(
    "i am a cool pirate\n- 2026-10-04 · beta is closed · until 2026-11-01\n",
  );
  expect(withLineEdited(text, 0, "a calm sailor", "2026-10-04")).toBe(
    "a calm sailor\n- 2026-10-01 · beta is open · until 2026-11-01\n",
  );
  expect(() => withLineEdited(text, 0, "  ", "2026-10-04")).toThrow("empty");
});

it("dates entries in the assistant's time zone", () => {
  const lateUtc = new Date(Date.UTC(2026, 9, 4, 20));
  expect(memoryDate(lateUtc, "UTC")).toBe("2026-10-04");
  expect(memoryDate(lateUtc, "Asia/Shanghai")).toBe("2026-10-05");
  expect(memoryDate(lateUtc, "Not/AZone")).toBe("2026-10-04");
});

it("loads whole lines up to the resident budget", () => {
  const text = Array.from({ length: MEMORY_MAX_LINES + 3 }, (_, i) => `- line ${i}`).join("\n");
  const budget = memoryWithinBudget(text);
  expect(budget.droppedLines).toBe(3);
  expect(budget.text.split("\n")).toHaveLength(MEMORY_MAX_LINES);
  expect(memoryWithinBudget("")).toEqual({ text: "", droppedLines: 0 });
});
