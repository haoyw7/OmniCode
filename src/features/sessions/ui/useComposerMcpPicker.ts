import { useCallback, useEffect, useRef, useState } from "react";
import type { HarnessId } from "../model/session";
import { type McpTag } from "../model/mcpPicker";
import { getComposerMcpTags, setComposerMcpTags } from "../model/draftCache";
import { type McpConnection } from "../../settings/model/mcp";
import {
  getCachedMcpSettings,
  loadMcpSettings,
  subscribeMcpSettings,
  type McpSettingsSnapshot,
} from "../../settings/model/mcpSettingsCache";

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
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Map<string, string>>(new Map());
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const [selectedMcp, setSelectedMcp] = useState<McpTag[]>(() =>
    sessionId ? getComposerMcpTags(sessionId) : [],
  );
  const mcpInsertAt = useRef<number | null>(null);

  const openMcpPicker = useCallback(() => {
    setMcpConnections([]);
    setMcpStatus(new Map());
    setMcpError("");
    setMcpLoading(true);
    setMcpPickerOpen(true);
  }, []);

  useEffect(() => {
    if (!mcpPickerOpen) return;
    const apply = (snapshot: McpSettingsSnapshot) => {
      setMcpConnections(snapshot.servers);
      setMcpStatus(
        new Map(
          snapshot.servers
            .filter((server) => server.provider === "claude")
            .map((server) => [server.name, server.status]),
        ),
      );
      setMcpError(snapshot.error);
      setMcpLoading(false);
    };
    const stop = subscribeMcpSettings(executionCwd, apply);
    const cached = getCachedMcpSettings(executionCwd);
    if (cached) apply(cached);
    void loadMcpSettings(executionCwd, false, {
      claudeHealth: harness === "claude",
      piHealth: harness === "pi",
    });
    return stop;
  }, [executionCwd, harness, mcpPickerOpen]);

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
