import { createContext, type ComponentType, type ReactNode } from "react";
import type { Block, InboxComposerCard, LinkedWorkItemUpdateCard, NoteCardMeta, Session, WorkspaceMode } from "../../../contracts/session";
import type { Skill } from "../../../contracts/skills";
import type { PopoverAnchor } from "../../../shared/ui/Popover";
import type { RecentProject } from "../../projects/model/recents";
import type { Worktree } from "../../../contracts/worktree";
import type { RemoteSessionProps } from "../../connections/model/remoteSessionPresentation";

type BranchProps = {
  cwd: string; branch?: string; enabled?: boolean; worktree?: boolean;
  initialOpen?: boolean; menuAnchor?: PopoverAnchor; popoverSide?: "top" | "bottom" | "right";
  onChange?: () => void; onClose?: () => void; onOpenChange?: (open: boolean) => void;
};
type WorkspaceProps = {
  cwd: string; mode: WorkspaceMode; base?: string; enabled?: boolean;
  workingName?: string; creating?: boolean; composerControls?: boolean;
  onModeChange: (mode: WorkspaceMode, base?: string) => void;
  onBaseChange: (base: string) => void; onSelectWorktree?: (tree: Worktree) => Promise<void>;
  onOpenSettings?: () => void; onClose?: () => void;
};
type WorktreeBaseProps = {
  branches: { name: string; remote: string | null }[]; selected: string;
  loading: boolean; enabled: boolean; initialOpen?: boolean; menuAnchor?: PopoverAnchor;
  popoverSide?: "top" | "bottom" | "right";
  onChange: (base: string) => void; onClose?: () => void; onOpenChange?: (open: boolean) => void;
};
type WorktreeProps = {
  cwd: string; executionCwd: string; enabled?: boolean; worktreeRemoved?: boolean;
  onSelect: (tree: Worktree) => Promise<void>; onBranchChange?: () => void;
  onManage?: () => void; onClose?: () => void;
};
type ProjectProps = {
  cwd: string; recents: RecentProject[]; projectLogoPath?: string | null; enabled?: boolean;
  buttonClassName?: string; chevron?: boolean; shortLabel?: string; openFolder?: boolean;
  onOpenFolder?: () => void; onCwdChange: (path: string) => void; onClear?: () => void; onClose?: () => void;
  menuFooter?: (menu: { close: () => void; hold: (held: boolean) => void }) => ReactNode;
};
type SkillProps = {
  skills: Skill[]; query: string; active: number; creating: boolean; cwd: string;
  error?: string | null; busy?: boolean; onActive: (index: number) => void; onPick: (skill: Skill) => void;
  onStartCreate: () => void; onCancelCreate: () => void; onCreate: (name: string, scope: "project" | "user") => void;
};
type LinkedUpdateProps = {
  sessionId: string; card?: LinkedWorkItemUpdateCard; onAcknowledge: () => void;
  onDismiss: () => void; onOpenDiscussion: () => void; onAddToChat: (text: string) => void;
  onArchiveSession?: () => Promise<boolean>; onDeleteSession?: () => Promise<boolean>;
};

/** Session surfaces request foreign feature presentation through application composition. */
export type SessionPresentation = {
  BranchPicker: ComponentType<BranchProps>;
  WorkspacePicker: ComponentType<WorkspaceProps>;
  WorktreeBasePicker: ComponentType<WorktreeBaseProps>;
  WorktreePicker: ComponentType<WorktreeProps>;
  WorkspaceIdentity: ComponentType<{ worktree: boolean; name?: string }>;
  CwdPicker: ComponentType<ProjectProps>;
  SkillPicker: ComponentType<SkillProps>;
  InboxMiniCard: ComponentType<{ card: InboxComposerCard; onDismiss?: () => void }>;
  NoteMiniCard: ComponentType<{ card: NoteCardMeta; onDismiss?: () => void; embedded?: boolean }>;
  LinkedWorkItemUpdateNotice: ComponentType<LinkedUpdateProps>;
  RemoteSession: ComponentType<RemoteSessionProps>;
};
function missingPresentation(): never { throw new Error("Session presentation is not configured"); }
export const SessionPresentationContext = createContext<SessionPresentation>({
  BranchPicker: missingPresentation, WorkspacePicker: missingPresentation,
  WorktreeBasePicker: missingPresentation, WorktreePicker: missingPresentation,
  WorkspaceIdentity: missingPresentation, CwdPicker: missingPresentation,
  SkillPicker: missingPresentation, InboxMiniCard: missingPresentation,
  NoteMiniCard: missingPresentation, LinkedWorkItemUpdateNotice: missingPresentation,
  RemoteSession: missingPresentation,
});

export type WorkflowRunParent = Pick<Session, "id" | "harness" | "model" | "modelSettings" | "workflowRuns"> & { cwd: string };
export type TranscriptCards = {
  OrchestrationPreview: ComponentType<{ block: Block; busy: boolean }>;
  WorkflowRunCard: ComponentType<{ block: Block; parent: WorkflowRunParent }>;
  NoteMiniCard: SessionPresentation["NoteMiniCard"];
};
export const TranscriptCardsContext = createContext<TranscriptCards>({
  OrchestrationPreview: missingPresentation, WorkflowRunCard: missingPresentation, NoteMiniCard: missingPresentation,
});
