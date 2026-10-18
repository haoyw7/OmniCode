import type { ClipboardEventHandler, ComponentType, DragEventHandler, ReactNode } from "react";
import type { RemoteAttachment, RemoteProvider } from "../../connections/model/protocol";
import type { BotLifecycle, BotMessage } from "../model/botView";

/** Presentation slots keep Host state and command ownership in AssistantChat. */
export type BotHeaderProps = {
  name: string;
  threadTitle?: string;
  botIdentity?: { id: string; avatar?: string };
  threadPicker?: ReactNode;
  hostName: string;
  harness?: RemoteProvider;
  status: string;
  /** Current activity shown inside the mobile header while the assistant runs. */
  activity?: string;
  lifecycle?: BotLifecycle;
  settingsOpen: boolean;
  busy: boolean;
  onSettings?: () => void;
  onClose?: () => void;
  controls?: BotControlsProps;
};
export type BotControlsProps = {
  busy: boolean;
  enabled: boolean;
  continuable: boolean;
  onToggle: () => void;
  onDisable: () => void;
  nextRetryAt?: number;
  backlog?: boolean;
};
export type BotSettingsPanelProps = {
  open: boolean;
  initialSetup: boolean;
  onClose: () => void;
  children: ReactNode;
};
/** Local preview bytes never become part of the Host attachment protocol. */
export type BotDraftAttachment = RemoteAttachment & { previewFile?: File };

export type BotComposerProps = {
  draft: string;
  placeholder?: string;
  errorNotice?: ReactNode;
  replyText?: string;
  onCancelReply?: () => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  /** Stops the running turn; offered in place of Send while the draft is empty. */
  onStop?: () => void;
  onAttach: (files: File[]) => void;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onDrop?: DragEventHandler<HTMLFormElement>;
  onRemoveAttachment: (id: string) => void;
  attachments: BotDraftAttachment[];
  busy: boolean;
  sending?: boolean;
  inputDisabled: boolean;
  attachDisabled: boolean;
  sendDisabled: boolean;
  retry: boolean;
  onRetry: () => void;
};
export type BotFeedbackProps = {
  messages: BotMessage[];
  historyIds: ReadonlySet<string>;
  active: boolean;
  busy: boolean;
  scope: string;
};
export type BotChatChrome = {
  Feedback?: ComponentType<BotFeedbackProps>;
  onSendFeedback?: (success: boolean) => void;
  Header: ComponentType<BotHeaderProps>;
  Controls: ComponentType<BotControlsProps>;
  SettingsPanel: ComponentType<BotSettingsPanelProps>;
  /** Optional platform wrapper for the settings action bar. */
  SettingsActions?: ComponentType<{ children: ReactNode }>;
  Composer: ComponentType<BotComposerProps>;
  MessageMenu?: ComponentType<BotMessageMenuProps>;
  /** Settings picker; desktop falls back to the shared searchable select. */
  Select?: ComponentType<BotSelectProps>;
  /** Opens one remembered fact in a panel; desktop falls back to a dialog. */
  MemoryDetail?: ComponentType<BotMemoryDetailProps>;
};
export type BotMemoryDetailProps = {
  open: boolean;
  text: string;
  /** Saved and expiry dates, already localized. */
  meta?: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSave: (text: string) => void;
  onForget: () => void;
};
export type BotSelectOption = { value: string; label: string; icon?: ReactNode };
export type BotSelectProps = {
  label: string;
  value: string;
  options: readonly BotSelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  hint?: string;
  /** Visually omit the label when a neighbouring control already names it. */
  hideLabel?: boolean;
  searchable?: boolean;
};
export type BotMessageMenuProps = {
  open: boolean;
  point?: { x: number; y: number };
  text?: string;
  replyable?: boolean;
  disabled: boolean;
  onReply: () => void;
  onClose: () => void;
};
