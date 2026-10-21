import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import {
  loadSkills,
  hasNativeCommands,
  subscribeSkills,
  mergeCatalog,
  skillCatalogQuery,
  skillCatalogKey,
  type Skill,
  type SkillCatalogContext,
} from "../../skills/model/skills";
import type { HarnessId } from "../model/session";

export type ComposerSkillContextToken = {
  key: string;
  generation: number;
};

export function nextComposerSkillContextToken(
  current: ComposerSkillContextToken | null,
  key: string,
): ComposerSkillContextToken {
  if (current?.key === key) return current;
  return { key, generation: (current?.generation ?? -1) + 1 };
}

export function pickerSkillLoadOptions(
  harness: HarnessId,
): { refresh: true } | undefined {
  return hasNativeCommands(harness) ? undefined : { refresh: true };
}

export function useComposerSkills(input: {
  harness: HarnessId;
  executionCwd: string;
  sessionId?: string;
  pickerOpen: boolean;
}) {
  const context = useMemo<SkillCatalogContext>(
    () => ({
      harness: input.harness,
      cwd: input.executionCwd,
      sessionId: input.sessionId,
    }),
    [input.executionCwd, input.harness, input.sessionId],
  );
  const contextKey = skillCatalogKey(context);
  const fallback = useMemo<Skill[]>(
    () => (hasNativeCommands(input.harness) ? [] : mergeCatalog([])),
    [input.harness],
  );
  const currentToken = useRef<ComposerSkillContextToken | null>(null);
  currentToken.current = nextComposerSkillContextToken(
    currentToken.current,
    contextKey,
  );
  const contextToken = currentToken.current;
  const catalog = useQuery(skillCatalogQuery(context), queryClient);

  const isCurrent = useCallback(
    (token: ComposerSkillContextToken) => currentToken.current === token,
    [],
  );
  const refresh = useCallback(
    async (options?: { refresh?: boolean }) => {
      const token = contextToken;
      await loadSkills(context, options);
      return isCurrent(token);
    },
    [isCurrent, context, contextToken],
  );

  useEffect(() => {
    return subscribeSkills(context);
  }, [context]);

  useEffect(() => {
    if (!input.pickerOpen) return;
    void refresh(pickerSkillLoadOptions(input.harness)).catch(() => undefined);
  }, [input.harness, input.pickerOpen, refresh]);

  return {
    contextKey,
    contextToken,
    isCurrent,
    refresh,
    skills: catalog.data ?? fallback,
  };
}
