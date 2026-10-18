import { describe, expect, it } from "vitest";
import { parseNativeSession } from "./nativeSessionParser";
import type { NativeSessionFile } from "./nativeSessions";

const lines = (...rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const base = { cwd: "/repo", revision: "1", modifiedAt: 10 };
const fixtures: { file: NativeSessionFile; content: string; id: string }[] = [
  ...(["pi", "omp"] as const).map((provider) => ({
    file: {
      ...base,
      provider,
      providerSessionId: "s1",
      path: "/sessions/s1.jsonl",
    },
    content: lines(
      ...(provider === "omp"
        ? [{ type: "title", title: "Native name", v: 1 }]
        : []),
      { type: "session", version: 3, id: "s1", cwd: "/repo" },
      {
        type: "message",
        id: "u1",
        parentId: null,
        message: { role: "user", content: "hello" },
      },
    ),
    id: `native-${provider}-u1`,
  })),
  {
    file: {
      ...base,
      provider: "claude",
      providerSessionId: "s1",
      path: "/sessions/s1.jsonl",
    },
    content: lines({
      type: "user",
      uuid: "u1",
      parentUuid: null,
      cwd: "/repo",
      sessionId: "s1",
      message: { content: "hello" },
    }),
    id: "native-claude-u1",
  },
  {
    file: {
      ...base,
      provider: "codex",
      providerSessionId: "s1",
      path: "/sessions/s1.jsonl",
    },
    content: lines(
      { type: "session_meta", payload: { id: "s1", cwd: "/repo" } },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "hello" },
      },
    ),
    id: "native-codex-1",
  },
  {
    file: {
      ...base,
      provider: "opencode",
      providerSessionId: "s1",
      path: "/sessions/opencode.db",
      storage: "sqlite",
    },
    content: JSON.stringify({
      session: { id: "s1", directory: "/repo" },
      messages: [
        {
          id: "u1",
          info: { role: "user" },
          parts: [{ id: "p1", type: "text", text: "hello" }],
        },
      ],
    }),
    id: "native-opencode-u1",
  },
];

describe("native parser provider routing", () => {
  it.each(fixtures)(
    "preserves $file.provider transcript semantics",
    ({ file, content, id }) => {
      expect(parseNativeSession(content, file)).toMatchObject({
        createdAt: 10,
        blocks: [{ id, role: "user", text: "hello" }],
        modelSettings: {},
      });
    },
  );
});
