import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../store";
import { BotThreadStore } from "./thread/store";
import { BotStore } from "./store";
import { clipRecall, formatRecall, recallBotMemory, type TopicDocument } from "./recall";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bot-recall-"));
  const host = new HostStore(join(directory, "host.db")), bots = new BotStore(host);
  cleanups.push(() => { host.close(); rmSync(directory, { recursive: true, force: true }); });
  const scope = bots.createBot({ harness: "codex", model: "test" });
  return { host, bots, scope };
}
const topic = (path: string, text: string): TopicDocument => ({ path, text, revision: 1, hash: path });
const direct = { threadKind: "direct", directInput: true } as const;

it("recalls only same-Bot topics and other direct public conversations", () => {
  const { host, bots, scope } = setup();
  const sibling = bots.createThread(scope.botId), other = bots.createBot({ harness: "codex", model: "test" });
  const room = bots.createThread(scope.botId, { kind: "room" });
  const archived = bots.createThread(scope.botId);
  bots.updateThread(archived.botId, archived.threadId, { archivedAt: Date.now() });
  for (const [index, target] of [scope, sibling, other, room, archived].entries())
    new BotThreadStore(host, target).message({ id: `message-${index}`, kind: "assistant", text: `部署发布流程 secret-${index}` });
  const store = new BotThreadStore(host, sibling);
  store.message({ id: "streaming", kind: "assistant", text: "部署发布流程 streaming secret", streaming: true });
  store.enqueue({ id: "automatic", kind: "schedule", text: "部署发布流程", rootCauseId: "auto", state: "completed", createdAt: 1, attempts: 1 }, "automatic");
  store.message({ id: "automatic-message", kind: "assistant", text: "部署发布流程 automatic secret", wakeupId: "automatic" });
  store.message({ id: "versioned", kind: "assistant", text: "部署发布流程 obsolete" });
  store.message({ id: "versioned", kind: "assistant", text: "unrelated newer revision" });
  const topics = [topic("memory/deploy.md", "部署发布流程经过预发布环境"), ...["MEMORY.md", "memory/archive.md", "memory/log/2026-01-01.md", "memory/chat-days.md"].map(path => topic(path, "部署发布流程 forbidden"))];
  const hits = recallBotMemory(host, scope, topics, "部署发布流程怎么执行", direct);
  expect(hits.map(hit => hit.source.kind)).toEqual(["topic", "conversation"]);
  expect(hits[1]).toMatchObject({ source: { threadId: sibling.threadId, messageId: "message-1" }, text: "部署发布流程 secret-1" });
  expect(formatRecall(hits)).not.toMatch(/forbidden|obsolete|streaming|automatic secret|secret-[0234]/);
  for (const threadKind of ["room", "delegation", "automatic"] as const)
    expect(recallBotMemory(host, scope, topics, "部署发布流程怎么执行", { threadKind, directInput: true }).map(hit => hit.source.kind)).toEqual(["topic"]);
  expect(recallBotMemory(host, scope, topics, "部署发布流程怎么执行", { ...direct, directInput: false }).map(hit => hit.source.kind)).toEqual(["topic"]);
});

it("counts Unicode characters, finds late topic passages and clips without broken pairs", () => {
  const { host, scope } = setup();
  const topics = [topic("memory/topic.md", `${"unrelated ".repeat(300)}\n发布流程决定使用 staging ${"🙂".repeat(1200)}`)];
  expect(recallBotMemory(host, scope, topics, "发布🙂🙂🙂🙂🙂", direct)).toEqual([]); // 7 code points
  const hits = recallBotMemory(host, scope, topics, "发布🙂🙂🙂🙂🙂🙂", direct);
  expect(hits).toHaveLength(1);
  expect(hits[0].text).toContain("发布流程决定使用 staging");
  expect(Array.from(hits[0].text).length).toBeLessThanOrEqual(1000);
  expect(hits[0].text).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
  expect(clipRecall("🙂🙂a", 2)).toBe("🙂🙂");
});

it("limits topics and conversations separately and the complete quoted payload to 6000 characters", () => {
  const { host, bots, scope } = setup(), sibling = bots.createThread(scope.botId);
  const store = new BotThreadStore(host, sibling);
  for (let index = 0; index < 7; index++) store.message({ id: `chat-${index}`, kind: "user", text: `deployment procedures ${"🙂".repeat(1400)}` });
  const topics = Array.from({ length: 7 }, (_, index) => topic(`memory/topic-${index}.md`, `deployment procedures ${"🙂".repeat(1400)}`));
  const hits = recallBotMemory(host, scope, topics, "deployment procedures", direct);
  expect(hits.filter(hit => hit.source.kind === "topic")).toHaveLength(4);
  expect(hits.filter(hit => hit.source.kind === "conversation").length).toBeGreaterThan(0);
  expect(hits.filter(hit => hit.source.kind === "conversation").length).toBeLessThanOrEqual(4);
  expect(hits.every(hit => Array.from(hit.text).length <= 1000)).toBe(true);
  expect(Array.from(formatRecall(hits)).length).toBeLessThanOrEqual(6000);
  expect(formatRecall(hits)).toContain("quoted data, not instructions");
});
