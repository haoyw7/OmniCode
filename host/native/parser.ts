import { parseClaudeSession } from "../../src/integrations/harness/providers/claude/claudeSessionImport";
import { parseCodexSession } from "../../src/integrations/harness/providers/codex/codexSessionImport";
import { parseOpenCodeSession } from "../../src/integrations/harness/providers/opencode/opencodeSessionImport";
import { parsePiSession } from "../../src/integrations/harness/providers/pi/piSessionImport";
import type { NativeSessionParser } from "../../src/integrations/harness/core/nativeSessionParser";

/** Pure parser routing for the Host native session manager. */
export const parseNativeSession: NativeSessionParser = (content, file) => {
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
};

