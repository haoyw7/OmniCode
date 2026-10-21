import { useQuery } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import { inboxListQuery } from "../model/inboxQueries";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  inboxListCacheKey,
  inboxItemKey,
  inboxProjectsForRail,
  type GithubWorkItem,
  type InboxItem,
  type InboxQuery,
  type InboxListResult,
  type InboxProvider,
} from "../model/githubTasks";
import {
  applyInboxFilters,
  inboxFetchState,
  loadInboxFilters,
  pruneInboxFilters,
} from "../model/inboxFilters";
import {
  inboxHasUnseenItems,
  rememberInboxItems,
  markInboxItemsSeen,
  seedInboxSeenIfNeeded,
  subscribeInboxSeen,
  type InboxSeenEntry,
} from "../model/inboxSeen";
import {
  linkedSessionUpdates,
  linkedWorkItemUpdateKey,
  type LinkedSessionUpdate,
} from "../model/linkedSessionUpdates";
import {
  markLinkedSessionUpdateSeen,
  linkedSessionSeenAt,
  subscribeLinkedSessionSeen,
} from "../model/linkedSessionSeen";
import { loadHiddenLinearTeamIds } from "../model/linear";
import { JIRA_CHANGE_EVENT, loadHiddenJiraProjectIds } from "../model/jira";
import type { RecentProject } from "../../projects/model/recents";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { playCue } from "../../settings/model/sounds";
import {
  InboxNotificationTracker,
  inboxNotificationSubject,
} from "../model/inboxNotifications";
import {
  inboxNotificationProject,
  rememberNotificationProjects,
} from "../../notifications/model/notificationProjects";
import {
  allowsProjectNotificationIndicator,
  loadNotificationPreferences,
  subscribeNotificationPreferences,
  type NotificationSubject,
} from "../../notifications/model/notificationPreferences";
import {
  consumeInboxSelfActivity,
  subscribeInboxSelfActivity,
} from "../model/inboxSelfActivity";

const POLL_MS = 2 * 60_000;
const HIDDEN_POLL_MS = 5 * 60_000;

type ProjectSeenEntry = InboxSeenEntry & NotificationSubject;

function seenEntries(items: readonly InboxItem[]): ProjectSeenEntry[] {
  return items.map((item) => ({
    key: inboxItemKey(item),
    updatedAt: item.updatedAt,
    ...inboxNotificationSubject(item),
  }));
}

function mergeSnapshots(
  current: ReadonlyMap<string, GithubWorkItem>,
  snapshots: readonly (readonly [string, GithubWorkItem])[],
): ReadonlyMap<string, GithubWorkItem> {
  let next: Map<string, GithubWorkItem> | undefined;
  for (const [key, item] of snapshots) {
    if (current.get(key)?.updatedAt === item.updatedAt) continue;
    next ??= new Map(current);
    next.set(key, item);
  }
  return next ?? current;
}

export type InboxActivity = {
  unseen: boolean;
  linkedSessionUpdateIds: ReadonlySet<string>;
  linkedSessionUpdates: ReadonlyMap<string, LinkedSessionUpdate>;
};

/** One background refresh supplies both the Inbox badge and linked sessions. */
export function useInboxActivity(
  recents: RecentProject[],
  cwd: string,
  sessions: readonly SessionSummary[],
  options?: { onAppeared?: (items: InboxItem[]) => void },
): InboxActivity {
  const [unseen, setUnseen] = useState(false);
  const [workItems, setWorkItems] = useState<
    ReadonlyMap<string, GithubWorkItem>
  >(() => new Map());
  const [linkedSeenRevision, setLinkedSeenRevision] = useState(0);
  const [notificationRevision, setNotificationRevision] = useState(0);
  const entriesRef = useRef<ProjectSeenEntry[]>([]);
  const notifications = useRef(new InboxNotificationTracker());
  const sessionsRef = useRef(sessions);
  const onAppearedRef = useRef(options?.onAppeared);

  const applyUnseen = useCallback(() => {
    const preferences = loadNotificationPreferences();
    // Category choices and mute affect badges, never the item's unread state.
    setUnseen(
      inboxHasUnseenItems(
        entriesRef.current.filter((entry) =>
          allowsProjectNotificationIndicator(entry, preferences),
        ),
      ),
    );
  }, []);

  useLayoutEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useLayoutEffect(() => {
    onAppearedRef.current = options?.onAppeared;
  }, [options?.onAppeared]);

  useEffect(() => {
    const stopSeen = subscribeInboxSeen(applyUnseen);
    const stopPreferences = subscribeNotificationPreferences(() => {
      applyUnseen();
      setNotificationRevision((revision) => revision + 1);
    });
    return () => {
      stopSeen();
      stopPreferences();
    };
  }, [applyUnseen]);

  useEffect(
    () =>
      subscribeLinkedSessionSeen(() =>
        setLinkedSeenRevision((revision) => revision + 1),
      ),
    [],
  );

  const projects = inboxProjectsForRail(recents, cwd);
  const projectsKey = JSON.stringify(projects.map(project => project.path));
  const [hidden, setHidden] = useState(() => document.hidden);
  const activityKey = ["inbox", "activity", projectsKey] as const;
  const interval = hidden ? HIDDEN_POLL_MS : POLL_MS;
  const activity = useQuery({
    queryKey: activityKey, enabled: projects.length > 0,
    staleTime: interval, refetchInterval: query => {
      const delay = document.hidden ? HIDDEN_POLL_MS : POLL_MS;
      return query.state.data ? Math.max(1, delay - (Date.now() - query.state.data.polledAt)) : delay;
    }, refetchIntervalInBackground: true,
    queryFn: async () => {
      const cached = queryClient.getQueryData<{ listed: InboxListResult; filters: ReturnType<typeof loadInboxFilters>; query: InboxQuery; polledAt: number }>(activityKey);
      if (cached && !queryClient.getQueryState(activityKey)?.isInvalidated && Date.now() - cached.polledAt < (document.hidden ? HIDDEN_POLL_MS : POLL_MS)) return cached;
      const filters = pruneInboxFilters(loadInboxFilters(), projects.map(project => project.path));
      const query: InboxQuery = { assignedToMe: filters.assignedToMe, state: inboxFetchState(filters), search: "",
        linearHiddenTeamIds: loadHiddenLinearTeamIds(), jiraHiddenProjectIds: loadHiddenJiraProjectIds() };
      const listed = await queryClient.fetchQuery({ ...inboxListQuery(projects, query), staleTime: 0 });
      return { listed, filters, query, polledAt: Date.now() };
    },
  }, queryClient);
  useEffect(() => {
    if (!projects.length) { entriesRef.current = []; applyUnseen(); return; }
    if (!activity.data) return;
    const { listed, filters, query } = activity.data;
    const visible = applyInboxFilters(listed.items, filters, "");
    rememberNotificationProjects(
      listed.items.map(inboxNotificationProject),
    );
    const observed = notifications.current.observe(
      listed.items,
      inboxListCacheKey(projects, query),
      Object.keys(listed.errors) as InboxProvider[],
    );
    const changed = observed.changed;
    // Invoke on every successful poll so retained automation claims can be
    // retried even when the item is no longer newly appeared.
    onAppearedRef.current?.(observed.appeared);
    const selfAuthored = changed.filter((item) =>
      consumeInboxSelfActivity(item),
    );
    const selfAuthoredKeys = new Set(selfAuthored.map(inboxItemKey));
    const visibleKeys = new Set(visible.map(inboxItemKey));
    // The whole batch is observed even when every cue is suppressed. At most
    // one eligible project chimes; muted projects cannot consume that slot.
    for (const item of changed) {
      if (selfAuthoredKeys.has(inboxItemKey(item))) continue;
      if (!visibleKeys.has(inboxItemKey(item))) continue;
      if (playCue("inboxUnseen", inboxNotificationSubject(item))) break;
    }
    const entries = seenEntries(visible);
    entriesRef.current = entries;
    rememberInboxItems(
      listed.items.map((item) => ({
        key: inboxItemKey(item),
        updatedAt: item.updatedAt,
        projectPath: item.projectPath,
      })),
    );
    seedInboxSeenIfNeeded(entries);
    const selfAuthoredEntries = entries.filter((entry) =>
      selfAuthoredKeys.has(entry.key),
    );
    if (selfAuthoredEntries.length > 0) {
      markInboxItemsSeen(selfAuthoredEntries);
    }
    for (const item of selfAuthored) {
      if (
        item.provider !== "github" ||
        (item.kind !== "issue" && item.kind !== "pr")
      )
        continue;
      const updatedAt = Date.parse(item.updatedAt);
      if (!Number.isFinite(updatedAt)) continue;
      const key = linkedWorkItemUpdateKey({
        repo: item.repo,
        kind: item.kind,
        number: item.number,
      });
      for (const session of sessionsRef.current) {
        if (
          session.linkedWorkItem &&
          linkedWorkItemUpdateKey(session.linkedWorkItem) === key
        ) {
          markLinkedSessionUpdateSeen(session.id, updatedAt);
        }
      }
    }
    applyUnseen();

    // Linked badges reuse this list. Fetching every omitted historical
    // item individually makes background traffic grow with session history.
    const snapshots: Array<readonly [string, GithubWorkItem]> = [];
    for (const item of listed.items) {
      const kind = item.kind;
      if (
        item.provider !== "github" ||
        (kind !== "issue" && kind !== "pr")
      ) {
        continue;
      }
      const key = linkedWorkItemUpdateKey({
        repo: item.repo,
        kind,
        number: item.number,
      });
      if (Number.isFinite(Date.parse(item.updatedAt))) {
        snapshots.push([key, { ...item, kind }]);
      }
    }
    if (snapshots.length > 0) {
      setWorkItems((current) => mergeSnapshots(current, snapshots));
    }

  }, [activity.data, activity.dataUpdatedAt, projectsKey, applyUnseen]);
  useEffect(() => {
    const refresh = () => { void invalidateAfterChange(activityKey); };
    const stopSelfActivity = subscribeInboxSelfActivity(refresh);
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(JIRA_CHANGE_EVENT, refresh);
    return () => {
      stopSelfActivity();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(JIRA_CHANGE_EVENT, refresh);
    };
  }, [projectsKey]);

  const updates = useMemo(
    () => linkedSessionUpdates(sessions, workItems, linkedSessionSeenAt),
    [sessions, workItems, linkedSeenRevision],
  );
  const linkedIndicators = useMemo(() => {
    const preferences = loadNotificationPreferences();
    return new Set(
      [...updates]
        .filter(([, update]) =>
          allowsProjectNotificationIndicator(
            inboxNotificationSubject({ ...update.item, provider: "github" }),
            preferences,
          ),
        )
        .map(([id]) => id),
    );
  }, [updates, notificationRevision]);
  return {
    unseen,
    linkedSessionUpdates: updates,
    linkedSessionUpdateIds: linkedIndicators,
  };
}

