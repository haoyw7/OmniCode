import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseNativeSession } from "../../src/integrations/harness/core/nativeSessionParser";
import { compactLine, NativeReader } from "./read";
import { findNativeSource, listNativeSessions, nativeSources, nativeSourceId, sourceFile, sourceFor } from "./sources";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "monocode-native-sources-"));
  roots.push(home);
  const write = (path: string, lines: unknown[]) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    return path;
  };
  const cwd = "/work/project";
  const claude = write(join(home, ".claude/projects/-work-project/11111111-aaaa.jsonl"), [
    { type: "summary", summary: "ignored" },
    { type: "user", uuid: "u1", parentUuid: null, sessionId: "11111111-aaaa", cwd, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "Claude prompt" } },
  ]);
  // Subagent transcripts and files without a conversation are skipped.
  write(join(home, ".claude/projects/-work-project/agent-1.jsonl"), [{ type: "user", uuid: "x", sessionId: "s", cwd }]);
  const codex = write(join(home, ".codex/sessions/2026/01/01/rollout-2026-01-01-22222222-bbbb.jsonl"), [
    { type: "session_meta", payload: { id: "22222222-bbbb", cwd, timestamp: "2026-01-01T00:00:00Z" } },
    { type: "event_msg", payload: { type: "user_message", message: "Codex prompt" } },
  ]);
  writeFileSync(join(home, ".codex/session_index.jsonl"), JSON.stringify({ id: "22222222-bbbb", thread_name: "Named thread" }) + "\n");
  // A sibling Codex profile is a separate source.
  write(join(home, ".codex-work/sessions/2026/01/02/rollout-2026-01-02-33333333-cccc.jsonl"), [
    { type: "session_meta", payload: { id: "33333333-cccc", cwd } },
  ]);
  const pi = write(join(home, ".pi/agent/sessions/--work-project--/2026_44444444-dddd.jsonl"), [
    { type: "session", version: 3, id: "44444444-dddd", cwd, timestamp: "2026-01-01T00:00:00Z" },
  ]);
  const omp = write(join(home, ".omp/agent/sessions/--work-project--/2026_55555555-eeee.jsonl"), [
    { type: "title", title: "padded" },
    { type: "session", version: 3, id: "55555555-eeee", cwd, timestamp: "2026-01-01T00:00:00Z" },
  ]);
  mkdirSync(join(home, ".local/share/opencode"), { recursive: true });
  const database = join(home, ".local/share/opencode/opencode.db");
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER, model TEXT);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, session_id TEXT, message_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    INSERT INTO session VALUES ('ses_66666666', NULL, '${cwd}', 'OpenCode title', 10, 20, NULL, NULL);
    INSERT INTO session VALUES ('ses_child', 'ses_66666666', '${cwd}', 'child', 10, 20, NULL, NULL);
    INSERT INTO message VALUES ('msg_1', 'ses_66666666', 11, 30, '{"role":"user"}');
    INSERT INTO part VALUES ('prt_1', 'ses_66666666', 'msg_1', 12, 31, '{"type":"text","text":"OpenCode prompt"}');`);
  db.close();
  // Account profiles published by the paired desktop.
  const desktop = join(home, "desktop");
  write(join(desktop, "provider-accounts/claude/work/projects/-work-project/77777777-ffff.jsonl"), [
    { type: "user", uuid: "w1", sessionId: "77777777-ffff", cwd, message: { role: "user", content: "Work account" } },
  ]);
  return { home, desktop, cwd, claude, codex, pi, omp, database, write, context: { home, env: {}, desktopDirectory: desktop } };
}

describe("Host native sources", () => {
  it("uses the selected OMP profile and custom agent directory for native history", () => {
    const { home, write, cwd } = fixture();
    const custom = join(home, "custom-agent");
    const omp = (env: Record<string, string>) => nativeSources({ home, env }).find((source) => source.provider === "omp");
    expect(omp({ PI_CODING_AGENT_DIR: custom })).toMatchObject({ dataDir: custom, root: join(custom, "sessions") });
    expect(omp({ PI_CODING_AGENT_DIR: custom, OMP_PROFILE: " team ", PI_PROFILE: "old", PI_CONFIG_DIR: ".omp-custom" }))
      .toMatchObject({ dataDir: join(home, ".omp-custom/profiles/team/agent"), root: join(home, ".omp-custom/profiles/team/agent/sessions") });
    expect(omp({ OMP_PROFILE: "default", PI_PROFILE: "old", PI_CODING_AGENT_DIR: custom })).toMatchObject({ dataDir: custom });
    expect(omp({ PI_PROFILE: "legacy" })).toMatchObject({ dataDir: join(home, ".omp/profiles/legacy/agent") });
    const shared = nativeSources({ home, env: { PI_CODING_AGENT_DIR: custom } });
    expect(shared.filter((source) => source.root === join(custom, "sessions")).map((source) => source.provider)).toEqual(["pi", "omp"]);
    const transcript = write(join(custom, "sessions/session-omp123.jsonl"), [{ type: "session", version: 3, id: "omp123", cwd }]);
    expect(sourceFile(transcript, "omp123", { home, env: { PI_CODING_AGENT_DIR: custom } }, "omp").provider).toBe("omp");
  });
  it("does not rediscover old managed Homes after removing their profile", () => {
    const { home, desktop } = fixture();
    const managed = join(desktop, "provider-accounts", "codex", "removed-account");
    const removed = join(desktop, "provider-accounts", "removed", "codex");
    mkdirSync(join(managed, "sessions"), { recursive: true });
    mkdirSync(removed, { recursive: true });
    writeFileSync(join(removed, "removed-account"), "");
    expect(nativeSources({ home, desktopDirectory: desktop, env: {} }).some(source => source.accountId === "removed-account")).toBe(false);
    writeFileSync(join(desktop, "provider-accounts", "accounts.json"), JSON.stringify({ codex: [{ id: "default", label: "CLI", dataHome: managed }] }));
    expect(nativeSources({ home, desktopDirectory: desktop, env: {} }).find(source => source.dataDir === managed)).toMatchObject({ accountId: "default" });
  });

  it.each(["custom", "default"])("keeps configured %s account bindings when a custom Home also matches a discovered sibling", async accountId => {
    const { home, desktop, write, cwd, context } = fixture();
    const codex = join(home, ".codex-work"), claude = join(home, "custom-claude");
    write(join(claude, "projects/-work-project/99999999-aaaa.jsonl"), [{ type: "user", uuid: "custom", sessionId: "99999999-aaaa", cwd, message: { role: "user", content: "Custom" } }]);
    writeFileSync(join(desktop, "provider-accounts/accounts.json"), JSON.stringify({ codex: [{ id: accountId, label: "Custom", dataHome: codex }], claude: [{ id: accountId, label: "Custom", dataHome: claude }] }));
    const listing = await listNativeSessions(context);
    expect(listing.sessions.filter(file => file.providerSessionId === "33333333-cccc")).toHaveLength(1);
    expect(listing.sessions.find(file => file.providerSessionId === "33333333-cccc")).toMatchObject({ accountId, dataDir: codex });
    expect(listing.sessions.find(file => file.providerSessionId === "99999999-aaaa")).toMatchObject({ accountId, dataDir: claude });
  });
  it("lists every provider like the desktop reader, including profiles and accounts", async () => {
    const { context, claude, codex, database } = fixture();
    const listing = await listNativeSessions(context);
    const byId = new Map(listing.sessions.map((file) => [file.providerSessionId, file]));
    expect([...byId.keys()].sort()).toEqual([
      "11111111-aaaa", "22222222-bbbb", "33333333-cccc", "44444444-dddd", "55555555-eeee", "77777777-ffff", "ses_66666666",
    ]);
    expect(byId.get("11111111-aaaa")).toMatchObject({ provider: "claude", path: claude.replaceAll("\\", "/"), cwd: "/work/project", preview: "Claude prompt", storage: "jsonl" });
    expect(byId.get("22222222-bbbb")).toMatchObject({ provider: "codex", path: codex.replaceAll("\\", "/"), title: "Named thread" });
    expect(byId.get("77777777-ffff")).toMatchObject({ provider: "claude", accountId: "work" });
    expect(byId.get("ses_66666666")).toMatchObject({
      provider: "opencode", path: database.replaceAll("\\", "/"), storage: "sqlite", title: "OpenCode title", revision: "sqlite:31:1:1",
    });
    expect(byId.get("11111111-aaaa")!.revision).toMatch(/^\d+:\d+$/);
    expect(listing.warnings).toEqual([]);
    // Source IDs are opaque, stable and distinct.
    const ids = listing.sessions.map(nativeSourceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(nativeSourceId(byId.get("11111111-aaaa")!)).toBe(ids[listing.sessions.findIndex((file) => file.path === claude.replaceAll("\\", "/"))]);
  });

  it("reads headers spanning several chunks without loading whole files", async () => {
    const { context, write, home, cwd } = fixture();
    // A Codex header carrying long instructions, and a Claude file whose first
    // conversational row follows a large metadata row.
    write(join(home, ".codex/sessions/2026/02/01/rollout-2026-02-01-88888888-aaaa.jsonl"), [
      { type: "session_meta", payload: { id: "88888888-aaaa", cwd, instructions: "x".repeat(200_000) } },
    ]);
    write(join(home, ".claude/projects/-work-project/99999999-bbbb.jsonl"), [
      { type: "summary", summary: "y".repeat(150_000) },
      { type: "user", uuid: "u", sessionId: "99999999-bbbb", cwd, message: { role: "user", content: "Late header" } },
    ]);
    const listing = await listNativeSessions(context);
    const ids = listing.sessions.map((file) => file.providerSessionId);
    expect(ids).toEqual(expect.arrayContaining(["88888888-aaaa", "99999999-bbbb"]));
    expect(listing.sessions.find((file) => file.providerSessionId === "99999999-bbbb")?.preview).toBe("Late header");
    expect(sourceFile(join(home, ".claude/projects/-work-project/99999999-bbbb.jsonl"), "99999999-bbbb", context).cwd).toBe(cwd);
    expect(listing.warnings).toEqual([]);
  });

  it("resolves a bound source by identity and rejects identity changes and ambiguity", () => {
    const { context, claude, write, home, cwd } = fixture();
    expect(sourceFile(claude, "11111111-aaaa", context)).toMatchObject({ providerSessionId: "11111111-aaaa" });
    expect(() => sourceFile(claude, "other", context)).toThrow("Native session identity changed");
    expect(() => sourceFor(join(home, "elsewhere.jsonl"), context)).toThrow("configured source");
    expect(findNativeSource("codex", "22222222-bbbb", undefined, context)?.title).toBeUndefined();
    expect(findNativeSource("claude", "11111111-aaaa", "default", context)?.path).toBe(claude.replaceAll("\\", "/"));
    expect(findNativeSource("claude", "missing", undefined, context)).toBeNull();
    // The same conversation in two default-account locations is never guessed.
    write(join(home, ".claude/projects/-copy/11111111-aaaa.jsonl"), [
      { type: "user", uuid: "u1", sessionId: "11111111-aaaa", cwd, message: { role: "user", content: "copy" } },
    ]);
    expect(() => findNativeSource("claude", "11111111-aaaa", undefined, context)).toThrow("ambiguous");
  });

  it("reads appended JSONL incrementally and reloads a rewritten prefix", async () => {
    const { context, claude } = fixture();
    const reader = new NativeReader();
    const file = sourceFile(claude, "11111111-aaaa", context);
    const source = sourceFor(claude, context);
    const first = await reader.read(source, file);
    const answer = { type: "assistant", uuid: "a1", parentUuid: "u1", sessionId: "11111111-aaaa", cwd: "/work/project", message: { role: "assistant", content: [{ type: "text", text: "Answer" }] } };
    appendFileSync(claude, JSON.stringify(answer) + "\n" + '{"type":"user","partial');
    const second = await reader.read(source, file);
    expect(second.content.startsWith(first.content)).toBe(true);
    expect(second.content.endsWith('"Answer"}]}}\n')).toBe(true);
    expect(second.revision).not.toBe(first.revision);
    const blocks = parseNativeSession(second.content, { ...file, revision: second.revision }).blocks;
    expect(blocks.map((block) => block.text)).toEqual(["Claude prompt", "Answer"]);
    writeFileSync(claude, JSON.stringify({ type: "user", uuid: "z", sessionId: "11111111-aaaa", cwd: "/work/project", message: { role: "user", content: "Rewritten" } }) + "\n");
    const third = await reader.read(source, file);
    expect(third.content).toContain("Rewritten");
    expect(third.content).not.toContain("Claude prompt");
  });

  it("drops records the parsers never read before parsing", () => {
    expect(compactLine("codex", JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { big: 1 } } })))
      .toBe('{"type":"event_msg","payload":{"type":"token_count"}}');
    expect(compactLine("codex", JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "keep" } })))
      .toContain("keep");
    expect(compactLine("pi", JSON.stringify({ type: "custom", id: "c", parentId: "p", data: { x: 1 } })))
      .toBe('{"type":"custom","id":"c","parentId":"p"}');
    const image = "A".repeat(9000);
    const claude = compactLine("claude", JSON.stringify({ type: "user", toolUseResult: { x: 1 }, message: { content: [{ type: "image", source: { data: image } }] } }));
    expect(claude).not.toContain("toolUseResult");
    expect(claude).toContain('"data":""');
    expect(compactLine("claude", '{"type":"user","message":"small"}')).toBeNull();
  });

  it("reads one consistent OpenCode snapshot from the shared database", async () => {
    const { context, database } = fixture();
    const file = sourceFile(database, "ses_66666666", context);
    const read = await new NativeReader().read(sourceFor(database, context), file);
    const document = JSON.parse(read.content);
    expect(document.session).toMatchObject({ id: "ses_66666666", title: "OpenCode title", timeCreated: 10 });
    expect(document.messages).toEqual([
      { id: "msg_1", timeCreated: 11, info: { role: "user" }, parts: [{ type: "text", text: "OpenCode prompt", id: "prt_1" }] },
    ]);
    expect(parseNativeSession(read.content, file).blocks[0]?.text).toBe("OpenCode prompt");
  });
});
