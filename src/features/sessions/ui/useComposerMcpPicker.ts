import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HarnessId } from "../model/session";
import { type McpTag } from "../model/mcpPicker";
import { getComposerMcpTags, setComposerMcpTags } from "../model/draftCache";
import { useMcpSettings } from "../../settings/model/mcpSettingsQueries";

/** The `/mcp` picker's servers and the servers the next message is tagged with. */
export function useComposerMcpPicker({
  executionCwd,
  harness,
  sessionId,
}: {
  executionCwd: string;
  harness: HarnessId;
  sessionId?: string;
}) {
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  const mcp = useMcpSettings(executionCwd, mcpPickerOpen, {
    claudeHealth: harness === "claude",
    piHealth: harness === "pi",
  });
  const mcpConnections = mcp.servers;
  const mcpStatus = useMemo(() => new Map(mcp.servers
    .filter((server) => server.provider === "claude")
    .map((server) => [server.name, server.status])), [mcp.servers]);
  const mcpLoading = mcp.loading;
  const mcpError = mcp.error;
  const [selectedMcp, setSelectedMcp] = useState<McpTag[]>(() =>
    sessionId ? getComposerMcpTags(sessionId) : [],
  );
  const mcpInsertAt = useRef<number | null>(null);

  const openMcpPicker = useCallback(() => setMcpPickerOpen(true), []);

  useEffect(() => {
    setMcpPickerOpen(false);
  }, [executionCwd, harness, sessionId]);

  useEffect(() => {
    if (sessionId) setComposerMcpTags(sessionId, selectedMcp);
  }, [sessionId, selectedMcp]);

  return {
    mcpPickerOpen,
    setMcpPickerOpen,
    mcpConnections,
    mcpStatus,
    mcpLoading,
    mcpError,
    selectedMcp,
    setSelectedMcp,
    mcpInsertAt,
    openMcpPicker,
  };
}
