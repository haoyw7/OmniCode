export type CheckpointFile = {
  path: string;
  relative: string;
  status: string;
  additions: number;
  deletions: number;
  /** True when an exact recorded before/after diff is available. */
  exact: boolean;
  /** False when restoring could overwrite a change made outside this session. */
  undoable: boolean;
  /** Recorded during the turn, but no edit tool of this session reported it;
   * it may come from shell commands or another writer. Never undone in bulk. */
  external?: boolean;
};

export type CheckpointStatus = {
  files: CheckpointFile[];
  /** Identity of the durable Git recording, absent for structured-edit fallback. */
  turnId?: string;
  /** This turn's workspace snapshot may include other concurrent sessions. */
  workspaceShared?: boolean;
  /** Host only: another running conversation shares this checkout. */
  undoLocked?: boolean;
  /** Provider and checkpoint boundaries must agree before restoring any file. */
  undoUnavailableReason?: string;
  /** Provider rollback is an entire turn; individual-file Undo is unsupported. */
  wholeTurnUndoOnly?: boolean;
  /** Provider history was already rewound; retry restores files without rewinding twice. */
  restorePending?: boolean;
  restoreMessage?: string;
};

export type CheckpointFileDiff = {
  path: string;
  relative: string;
  status: string;
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
};

export type CheckpointApplyResult = {
  files: string[];
  alreadyApplied: number;
};
