import { sameProjectPath } from "../../projects/model/recents";
import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";

const MAX_PENDING_AGE_MS = 10 * 60_000;

export type InboxSelfActivityTarget = {
  provider: "github" | "gitlab" | "linear" | "jira" | "azuredevops";
  kind?: "issue" | "pr" | "linear" | "jira";
  repo?: string;
  number?: number;
  id?: string;
  projectPath?: string;
};

export type InboxSelfActivityItem = InboxSelfActivityTarget & {
  kind: "issue" | "pr" | "linear" | "jira";
  number: number;
  projectPath: string;
};

type PendingActivity = InboxSelfActivityTarget & { recordedAt: number };
type Listener = () => void;

const activityStore = createStore(subscribeWithSelector(() => ({ pending: [] as PendingActivity[], revision: 0 })));

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matches(activity: PendingActivity, item: InboxSelfActivityItem) {
  if (activity.provider !== item.provider) return false;
  if (activity.id && activity.id !== item.id) return false;
  if (activity.kind && activity.kind !== item.kind) return false;
  if (activity.number != null && activity.number !== item.number) return false;
  if (activity.repo && normalized(activity.repo) !== normalized(item.repo)) {
    return false;
  }
  if (
    activity.projectPath &&
    !sameProjectPath(activity.projectPath, item.projectPath)
  ) {
    return false;
  }
  return Boolean(
    activity.id ||
    activity.repo ||
    activity.number != null ||
    activity.projectPath,
  );
}

/** Remember a successful mutation so its resulting remote revision is not announced back to its author. */
export function recordInboxSelfActivity(
  target: InboxSelfActivityTarget,
  now = Date.now(),
) {
  activityStore.setState(state => ({
    pending: [...state.pending.filter(item => item.recordedAt >= now - MAX_PENDING_AGE_MS), { ...target, recordedAt: now }],
    revision: state.revision + 1,
  }));
}

/** Consume all coalesced mutations for this revision. A later revision can notify normally. */
export function consumeInboxSelfActivity(
  item: InboxSelfActivityItem,
  now = Date.now(),
): boolean {
  let consumed = false;
  const pending = activityStore.getState().pending.filter(activity => {
    if (activity.recordedAt < now - MAX_PENDING_AGE_MS) return false;
    if (!matches(activity, item)) return true;
    consumed = true;
    return false;
  });
  // Consuming a receipt must not recursively trigger the notification processor.
  activityStore.setState({ pending });
  return consumed;
}

export function subscribeInboxSelfActivity(listener: Listener): () => void {
  return activityStore.subscribe(state => state.revision, listener);
}

export function clearPendingInboxSelfActivity() {
  activityStore.setState({ pending: [] });
}
