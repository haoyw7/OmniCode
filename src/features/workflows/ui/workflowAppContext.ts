// What the workflow views need from the desktop shell: navigation and composer.
import { createContext, useContext } from "react";
import type { WorkflowAgentAvatar } from "../model/workflowAgentAvatar";
import type { WorkflowArtifactTabSource } from "../../workspace/model/layout";

export type OpenWorkflowRunRequest = {
  /** Project folder (desktop path) the run belongs to. */
  cwd: string;
  parentSessionId: string;
  runId: string;
  toolCallId?: string;
  workflowName?: string;
  /** Replace an open run tab (a retuned run moved to its successor). */
  replaceRunId?: string;
};

export type OpenWorkflowAgentRequest = {
  avatar?: WorkflowAgentAvatar;
  cwd: string;
  parentSessionId: string;
  runId: string;
  /** Hidden Host session the subagent runs in. */
  sessionId: string;
  title: string;
  /** Open beside this workflow detail tab when it is still available. */
  sourceFileId?: string;
};

export type WorkflowAppActions = {
  openArtifact(request: WorkflowArtifactTabSource & { cwd: string; title?: string; sourceFileId?: string }): void;
  openRun(request: OpenWorkflowRunRequest): void;
  openAgent(request: OpenWorkflowAgentRequest): void;
  /** Open a conversation the Host created (a saved workflow launched from the sidebar). */
  openSession(cwd: string, sessionId: string): void;
  /**
   * Start a new conversation in a project with this text in its composer, or
   * send it right away when it is a complete instruction.
   */
  createViaChat(cwd: string, prompt: string, options?: { send?: boolean }): void;
  /** Open a project file in the editor. */
  openFile?(path: string): void;
};

export const WorkflowAppContext = createContext<WorkflowAppActions | null>(null);

export function useWorkflowApp(): WorkflowAppActions | null {
  return useContext(WorkflowAppContext);
}
