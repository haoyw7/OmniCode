import { parseClaudeSession } from "../providers/claude/claudeSessionImport";
import { parseCodexSession } from "../providers/codex/codexSessionImport";
import { parseOpenCodeSession } from "../providers/opencode/opencodeSessionImport";
import { parsePiSession } from "../providers/pi/piSessionImport";
import type { NativeSessionFile, NativeTranscript } from "./nativeSessions";

/** Pure parser routing for the Host native session manager. */
export function parseNativeSession(
  content: string,
  file: NativeSessionFile,
): NativeTranscript {
  switch (file.provider) {
    case "codex":
      return parseCodexSession(content, file);
    case "claude":
      return parseClaudeSession(content, file);
    case "opencode":
      return parseOpenCodeSession(content, file);
    case "pi":
    case "omp":
      return parsePiSession(content, file);
  }
}

