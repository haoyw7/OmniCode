import { describe, expect, it } from "vitest";
import { parsePiSession } from "./piSessionImport";
import type { NativeSessionFile } from "../../core/nativeSessions";
const file: NativeSessionFile = {
  provider: "pi",
  providerSessionId: "pi-id",
  cwd: "/repo",
  path: "/pi/session.jsonl",
  revision: "1",
  modifiedAt: 10,
};
const header = { type: "session", version: 3, id: "pi-id", cwd: "/repo" };
const lines = (...records: unknown[]) =>
  [header, ...records].map((record) => JSON.stringify(record)).join("\n") +
  "\n";
const entry = (id: string, parentId: string | null, extra: object) => ({
  id,
  parentId,
  ...extra,
});

describe("Pi session import", () => {
  it.each(["pi", "omp"] as const)("retains user and assistant message times for %s", (provider) => {
    const result = parsePiSession(lines(
      entry("u", null, { type: "message", timestamp: "2026-10-05T10:00:00Z", message: { role: "user", content: "Question" } }),
      entry("a", "u", { type: "message", timestamp: "2026-10-05T10:00:10Z", message: { role: "assistant", content: [{ type: "text", text: "Answer" }] } }),
    ), { ...file, provider });
    expect(result.blocks.map((block) => block.startedAt)).toEqual([
      Date.parse("2026-10-05T10:00:00Z"), Date.parse("2026-10-05T10:00:10Z"),
    ]);
  });

  it("follows the current branch, applies context edits, and preserves native settings/name", () => {
    const result = parsePiSession(
      lines(
        entry("u1", null, {
          type: "message",
          message: { role: "user", content: "hello" },
        }),
        entry("old", "u1", {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "abandoned" }],
          },
        }),
        entry("new", "u1", {
          type: "message",
          message: {
            role: "assistant",
            provider: "openai",
            model: "test",
            content: [{ type: "text", text: "current" }],
          },
        }),
        entry("edit", "new", {
          type: "context_edit",
          targetId: "new",
          replacement: { content: [{ type: "text", text: "edited" }] },
        }),
        entry("think", "edit", {
          type: "thinking_level_change",
          thinkingLevel: "high",
        }),
        entry("name", "think", { type: "session_info", name: "My session" }),
      ),
      file,
    );
    expect(result.blocks.map((block) => block.text)).toEqual([
      "hello",
      "edited",
    ]);
    expect(result.model).toBe("pi:openai/test");
    expect(result.modelSettings).toEqual({ thinking: "high" });
    expect(result.title).toBe("My session");
  });
  it("retains tool results and substitutes image content without showing base64", () => {
    const result = parsePiSession(
      lines(
        entry("u", null, {
          type: "message",
          message: { role: "user", content: "look" },
        }),
        entry("a", "u", {
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "c",
                name: "read",
                arguments: { path: "x" },
              },
            ],
          },
        }),
        entry("t", "a", {
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "c",
            content: [
              { type: "text", text: "result" },
              { type: "image", data: "SECRET_BASE64", mimeType: "image/png" },
            ],
          },
        }),
      ),
      file,
    );
    expect(result.blocks[1].tool?.detail).toContain("result");
    expect(result.blocks[1].tool?.detail).toContain("native session");
    expect(JSON.stringify(result)).not.toContain("SECRET_BASE64");
  });
  it("rejects unsupported versions, missing parents, and cycles", () => {
    expect(() =>
      parsePiSession(JSON.stringify({ ...header, version: 2 }) + "\n", file),
    ).toThrow("Unsupported");
    expect(() =>
      parsePiSession(lines(entry("x", "missing", { type: "message" })), file),
    ).toThrow("missing parent");
    expect(() =>
      parsePiSession(lines(entry("x", "x", { type: "message" })), file),
    ).toThrow("cycle");
  });
});

describe("omp session import (shared Pi parser)", () => {
  const ompFile: NativeSessionFile = { ...file, provider: "omp", providerSessionId: "omp-id" };
  const title = (value: string) => ({ type: "title", v: 1, title: value, pad: "    " });
  const ompHeader = { type: "session", version: 3, id: "omp-id", cwd: "/repo" };
  const ompLines = (...records: unknown[]) =>
    records.map((record) => JSON.stringify(record)).join("\n") + "\n";

  it("skips padded title records and reads omp model strings", () => {
    const result = parsePiSession(
      ompLines(
        title(""),
        ompHeader,
        entry("m", null, { type: "model_change", model: "ollama/qwen3:14b" }),
        entry("t", "m", { type: "thinking_level_change", thinkingLevel: "high" }),
        entry("u", "t", { type: "message", message: { role: "user", content: [{ type: "text", text: "ping" }] } }),
        entry("a", "u", {
          type: "message",
          message: { role: "assistant", provider: "ollama", model: "qwen3:14b", content: [{ type: "text", text: "pong" }] },
        }),
        title("Named by omp"),
      ),
      ompFile,
    );
    expect(result.blocks.map((block) => [block.id, block.text])).toEqual([
      ["native-omp-u", "ping"],
      ["native-omp-a", "pong"],
    ]);
    expect(result.model).toBe("omp:ollama/qwen3:14b");
    expect(result.modelSettings.thinking).toBe("high");
    expect(result.title).toBe("Named by omp");
  });

  it("keeps Pi strict about a leading title record", () => {
    expect(() => parsePiSession(ompLines(title(""), header), file)).toThrow();
    expect(parsePiSession(lines(entry("u", null, { type: "message", message: { role: "user", content: "x" } })), file).blocks[0].id).toBe("native-pi-u");
  });

  it("follows the newest omp branch and rejects cycles", () => {
    const message = (text: string) => ({ type: "message", message: { role: "user", content: text } });
    const result = parsePiSession(ompLines(
      title("Named"), ompHeader,
      entry("u", null, message("first")),
      entry("old", "u", message("abandoned")),
      entry("new", "u", message("current")),
    ), ompFile);
    expect(result.blocks.map((block) => block.text)).toEqual(["first", "current"]);
    expect(() => parsePiSession(ompLines(title("Named"), ompHeader, entry("x", "x", message("cycle"))), ompFile)).toThrow("cycle");
  });
});
