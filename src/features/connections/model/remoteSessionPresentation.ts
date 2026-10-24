import type { ReactNode } from "react";
import type { HarnessId, QueuedMessage, QueueReturnPosition, Session } from "../../../contracts/session";
import type { HostSession } from "../../../contracts/protocol";
import type { SessionPaneProps } from "../../sessions/model/sessionPane";

export type RemoteSessionOverrides = Partial<SessionPaneProps> & {
  initialPromptId?: string;
  messageQueue?: { render: (restore: (message: QueuedMessage, position?: QueueReturnPosition) => void) => ReactNode };
  composerNotice?: ReactNode;
  hostManaged: boolean;
  remoteSession: boolean;
  hostFeatures: { attachments: boolean; plan: boolean; draft: boolean; orchestration?: boolean; checkpoint?: boolean };
  hostSessionLoading: boolean;
  hostSessionStarted: boolean;
  allowedModelHarnesses: readonly HarnessId[];
};

export type RemoteSessionProps = {
  /** The tab's local session, which provides its ID and new-session defaults. */
  shell: Session;
  visible: boolean;
  onSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onOpenFile: SessionPaneProps["onOpenFile"];
  onOpenDiff: SessionPaneProps["onOpenDiff"];
  onOpenPlan: SessionPaneProps["onOpenPlan"];
  render: (overrides: RemoteSessionOverrides) => ReactNode;
  unavailableHeader?: ReactNode;
};
