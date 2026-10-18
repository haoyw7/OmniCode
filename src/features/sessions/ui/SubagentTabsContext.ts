import { createContext, useCallback, useContext } from "react";
import type { SubagentTabSource } from "../../workspace/model/layout";
import { sessionExecutionCwd, type Block, type Session } from "../model/session";
import { subagentName } from "../model/transcriptActivity";

export type OpenSubagentRequest = SubagentTabSource & {
  title: string;
  cwd: string;
  sourceFileId?: string;
};

export const SubagentTabsContext = createContext<
  ((request: OpenSubagentRequest) => void) | null
>(null);

const ROOT_PATH: readonly string[] = [];

/** Keep identities, not transcript snapshots, in tabs so streamed records stay live. */
export function useOpenSubagent(
  session: Session | undefined,
  path: readonly string[] = ROOT_PATH,
  sourceFileId?: string,
) {
  const open = useContext(SubagentTabsContext);
  const openAgent = useCallback(
    (block: Block) => {
      if (!session) return;
      open?.({
        parentSessionId: session.id,
        path: [...path, block.id],
        harness: session.harness,
        cwd: sessionExecutionCwd(session),
        title: subagentName(block),
        sourceFileId,
      });
    },
    [
      open,
      session?.id,
      session?.harness,
      session?.cwd,
      session?.executionCwd,
      path,
      sourceFileId,
    ],
  );
  return open && session ? openAgent : undefined;
}
