import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ToolContentSource, ToolContentSelection } from "../../../integrations/harness/core/toolContent";
import { TranscriptPlatformContext } from "./TranscriptPlatform";

export function ToolContentProvider({ source, children }: { source?: ToolContentSource; children: ReactNode }) {
  const parent = useContext(TranscriptPlatformContext);
  const scope = JSON.stringify(source?.key);
  const [selection, setSelection] = useState<{ scope: string | undefined; value?: ToolContentSelection }>();
  const select = useCallback((value?: ToolContentSelection) => setSelection(previous =>
    previous && previous.scope === scope && JSON.stringify(previous.value) === JSON.stringify(value) ? previous : { scope, value }), [scope]);
  const platform = useMemo(() => ({ ...parent, toolContent: source,
    toolContentSelection: selection?.scope === scope ? selection?.value : undefined,
    selectToolContent: select,
  }), [parent, source, scope, selection, select]);
  return <TranscriptPlatformContext.Provider value={platform}>{children}</TranscriptPlatformContext.Provider>;
}
