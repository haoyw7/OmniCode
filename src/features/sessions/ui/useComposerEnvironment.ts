import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getComposerEnvironment, setComposerEnvironment } from "../model/draftCache";
import { parseWslPath, wslPath } from "../../../shared/lib/wslPaths";
import { pickWslFolder } from "../../../platform/tauri/wsl";
import { showStatusToast } from "../../../shared/ui/StatusToast";
import { useTranslation } from "../../../shared/i18n/useTranslation";

/** An environment choice is a draft preference until a folder is chosen separately. */
export function useComposerEnvironment(sessionId: string | undefined, cwd: string, onCwdChange: (cwd: string) => void) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<{ sessionId?: string; cwd: string; distribution: string | null }>();
  const saved = sessionId ? getComposerEnvironment(sessionId) : choice;
  const actual = parseWslPath(cwd)?.machine.distribution ?? null;
  const distribution = saved?.cwd === cwd && (sessionId || choice?.sessionId === sessionId)
    ? saved.distribution : actual;
  const needsProject = distribution !== actual || (!!distribution && cwd === "~");
  const version = useRef(0);
  const picking = useRef(false);
  useEffect(() => {
    version.current++;
    if (sessionId && getComposerEnvironment(sessionId)?.cwd !== cwd) setComposerEnvironment(sessionId, undefined);
    return () => { version.current++; };
  }, [sessionId, cwd]);

  const select = useCallback((distribution: string | null) => {
    version.current++;
    const next = { sessionId, cwd, distribution };
    if (sessionId) setComposerEnvironment(sessionId, next);
    setChoice(next);
  }, [sessionId, cwd]);
  const pickFolder = useCallback(async () => {
    if (!distribution || picking.current) return;
    picking.current = true;
    const started = version.current;
    try {
      const path = await pickWslFolder(distribution, t("Open a WSL project"));
      if (path && started === version.current) onCwdChange(wslPath(distribution, path));
    } catch (reason) {
      if (started === version.current) showStatusToast(t(String(reason).replace(/^Error: /, "")), "error");
    } finally {
      picking.current = false;
    }
  }, [distribution, onCwdChange, t]);
  return useMemo(() => ({ distribution, needsProject, select, pickFolder }), [distribution, needsProject, select, pickFolder]);
}
