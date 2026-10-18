import { describe, expect, it } from "vitest";
import { providerSessionAccessIssue } from "./sessionAccessErrors";
import type { HarnessId } from "../../../features/sessions/model/session";

describe("provider session access errors", () => {
  it.each<[HarnessId, string]>([
    ["codex", "thread 01a106ef already has an active writer"],
    ["claude", "Can't open — this session is running in another terminal"],
    ["claude", "Session original is open in another Claude Code process"],
    [
      "omp",
      "Session publish lock unavailable for /tmp/chat.jsonl: another writer holds the publish lock",
    ],
    [
      "fx",
      "This session is open in another fx. Close it there, then press enter to retry.",
    ],
    [
      "hermes",
      "This chat is open in another Hermes window/terminal. Use it there, or start a new chat here.\nDetails: session fixture opened by cli.",
    ],
    ["hermes", "Session fixture already has a live owner"],
    [
      "cursor",
      "Chat fixture is already running in persistent session background",
    ],
  ])("recognizes %s external ownership", (harness, message) => {
    expect(providerSessionAccessIssue(harness, new Error(message))).toBe(
      "occupied",
    );
  });

  it.each<[HarnessId, string]>([
    ["fx", "Session is busy"],
    ["fx", "SessionLockUnsupported"],
    [
      "omp",
      "Session publish lock unavailable for /tmp/chat.jsonl: unable to acquire the lock",
    ],
    ["hermes", "SESSION_COORDINATION_UNAVAILABLE"],
    ["hermes", "Hermes could not read the active-session registry"],
  ])(
    "does not claim an external owner for ambiguous %s access",
    (harness, message) => {
      expect(providerSessionAccessIssue(harness, message)).toBe("unavailable");
    },
  );

  it.each<[HarnessId, string]>([
    ["codex", "database is locked"],
    ["claude", "OAuth login is already in use by another process"],
    ["omp", "SessionWriteConflictError: session content changed"],
    ["hermes", "Session is busy; switch models while the session is idle"],
    ["hermes", "Hermes is at the active session limit (4/4)."],
    ["cursor", "Agent Store import is already mutating fixture"],
    ["opencode", "SessionBusyError"],
    ["pi", "Session is busy"],
    ["grok", "auth lock held by another process"],
    ["antigravity", "database is locked"],
  ])("leaves unrelated %s failures unchanged", (harness, message) => {
    expect(providerSessionAccessIssue(harness, message)).toBeUndefined();
  });
});
