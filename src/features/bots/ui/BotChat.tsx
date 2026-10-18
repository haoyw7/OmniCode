import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { botReadRevision, markBotRead } from "../model/botUnread";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  startTransition,
  type ReactNode,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { readClipboardImage } from "../../../platform/tauri/clipboard";
import { filesFromClipboard } from "../../sessions/model/attachments";
import { flushSync } from "react-dom";
import { BotClient, type BotRpc } from "../model/botRpc";
import { compactBotTimeline } from "../model/botTimeline";
import type {
  BotMessage,
  BotPatch,
  BotConfiguration,
  SessionReference,
} from "../model/botView";
import type {
  HostDescriptor,
  HostModelCatalog,
  HostProject,
  HostSessionSummary,
  RemoteAttachment,
} from "../../connections/model/protocol";
import { botErrorMessage } from "../model/botErrors";
import { quoteBotReply } from "../model/botReply";
import { REMOTE_PROVIDERS } from "../../connections/model/protocol";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { BotSettings } from "./BotSettings";
import { AnimatedCollapse, useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { BotWorkerDetails } from "./BotWorkerDetails";
import { resolveBotTarget, type BotTarget } from "../model/botNavigation";
import { botActivityLabel } from "../model/botActivity";
import type {
  BotChatChrome,
  BotControlsProps,
  BotDraftAttachment,
} from "./BotChatChrome";
import {
  desktopBotsLegacyChrome,
  DesktopBotsMessageMenu,
} from "./DesktopBotsLegacyChrome";
import { useBotReplyMenu } from "./useBotReplyMenu";
import { useBotDraft } from "./useBotDraft";
import { useBotMessageSwipe } from "./useBotMessageSwipe";
import { BotMessages } from "./BotMessages";
import { TranscriptPlatformContext } from "../../sessions/ui/TranscriptPlatform";
import {
  useTranscriptRenderingPlatform,
} from "../../sessions/ui/useTranscriptRenderingPlatform";
import { Shimmer } from "../../../shared/ui/Shimmer";
import { ComposerNotice, ComposerNoticeButton } from "../../../shared/ui/ComposerNotice";
import { withStatusToast } from "../../../shared/ui/StatusToast";
import { usePauseOffscreenAnimation } from "../../../shared/hooks/usePauseOffscreenAnimation";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { slidePromptIn } from "../../sessions/ui/promptLaunch";
import { ArrowUp, X, Loader2, Sparkles } from "../../../shared/ui/icons";
import { DesktopBotsNavigation, desktopBotsChrome } from "./DesktopBotsChrome";
import { BotIdentitySettings } from "./BotIdentitySettings";
import { BotAttachmentCard } from "./BotAttachmentCard";
import { DesktopBotDetails } from "./DesktopBotDetails";

/** History renders newest-first in slices so opening never blocks the app. */
const INITIAL_HISTORY_ROWS = 30;
const HISTORY_ROW_STEP = 30;
/** Older rows load once the reader is this close to the top. */
const HISTORY_LOAD_DISTANCE = 800;
// A message that takes longer than this to appear no longer animates its send.
const LAUNCH_TTL_MS = 15_000;
import "./bots.css";
import "./desktop-bots.css";
import "./desktop-bot-tokens.css";
import "./desktop-bot-messenger.css";

type ReadingAnchor = { node: Element; offset: number; scrollTop: number };
const ANCHOR_ROWS = ".assistant-message-row, .assistant-card, .assistant-input";

/**
 * The row at the middle of the viewport, by binary search. Rows entering at
 * either edge still carry an estimated height, so the middle stays stable.
 */
function readingAnchor(log: HTMLElement): ReadingAnchor | undefined {
  const top = log.getBoundingClientRect().top;
  const middle = top + log.clientHeight / 2;
  const rows = log.children;
  let low = 0,
    high = rows.length - 1,
    found = -1;
  while (low <= high) {
    const index = (low + high) >> 1;
    if (rows[index].getBoundingClientRect().bottom > middle) {
      found = index;
      high = index - 1;
    } else low = index + 1;
  }
  // Date separators come and go as older rows join; anchor on a message.
  for (let index = Math.max(found, 0); found >= 0 && index < rows.length; index++) {
    const node = rows[index];
    if (!node.matches(ANCHOR_ROWS)) continue;
    return {
      node,
      offset: node.getBoundingClientRect().top - top,
      scrollTop: log.scrollTop,
    };
  }
  return undefined;
}

/**
 * Cancels size changes above the anchored row. Scrolling since the anchor was
 * taken is the reader's own movement and is kept.
 */
function restoreReadingAnchor(
  log: HTMLElement,
  anchor?: ReadingAnchor,
): ReadingAnchor | undefined {
  if (!anchor?.node.isConnected) return anchor;
  const expected = anchor.offset - (log.scrollTop - anchor.scrollTop);
  const delta =
    anchor.node.getBoundingClientRect().top -
    log.getBoundingClientRect().top -
    expected;
  if (Math.abs(delta) >= 1) log.scrollTop += delta;
  return { ...anchor, offset: expected, scrollTop: log.scrollTop };
}

function followScrollTop(element: HTMLElement, mobile: boolean) {
  if (!mobile) return element.scrollHeight;
  const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
  let latest = element.lastElementChild;
  if (latest?.matches(".assistant-working"))
    latest = latest.previousElementSibling;
  if (!latest?.matches(".assistant-message-row, .assistant-card, .assistant-input"))
    return bottom;
  const rect = latest.getBoundingClientRect();
  if (!rect.height) return bottom;
  const inset = Number.parseFloat(getComputedStyle(element).scrollPaddingTop) || 0;
  // Numeric scrollTo ignores scroll-padding. Keep the latest bubble's start
  // below the floating header even when a reply grows beyond the viewport.
  const latestTop =
    rect.top - element.getBoundingClientRect().top + element.scrollTop;
  return Math.max(0, Math.min(bottom, latestTop - inset));
}

function syncHeaderHeight(chat: HTMLElement | null, mobile: boolean) {
  const header = chat?.querySelector<HTMLElement>(mobile
    ? ".mobile-assistant-header > .mobile-header-title"
    : ".assistant-header");
  if (!chat || !header) return;
  const height = header.getBoundingClientRect().height;
  if (!height) return;
  // Leave the same gap above and below the capsule as it expands downward.
  const next = `${Math.ceil(height + (mobile ? header.offsetTop * 2 : 0))}px`;
  const property = mobile ? "--mobile-header-height" : "--assistant-header-height";
  if (chat.style.getPropertyValue(property) !== next)
    chat.style.setProperty(property, next);
}

export function BotChat({
  hostKey,
  rpc,
  onOpen,
  onClose,
  hostName,
  chrome,
  onOpenAttachment,
  desktopBots = false,
  cacheKey = hostKey,
  botNavigation,
  threadTitle,
  botThreadPicker,
  botPinControl,
  botSettings,
  botAvatarSupported = false,
  botMemory,
  botRuntime,
  botActivity,
  botAutomation,
  botManagement,
  botDelegations,
  renderBotDelegation,
  botReadOnlyReason,
}: {
  hostKey: string;
  rpc: BotRpc;
  onOpen: (ref: SessionReference, target: BotTarget) => Promise<void> | void;
  onClose?: () => void;
  hostName: string;
  chrome?: BotChatChrome;
  /** Opt into the desktop shell only when the Host advertises its capability. */
  desktopBots?: boolean;
  /** Storage identity is separate from the real Host identity used for navigation. */
  cacheKey?: string;
  botNavigation?: ReactNode;
  threadTitle?: string;
  botThreadPicker?: ReactNode;
  botPinControl?: ReactNode;
  /** Bot defaults stay separate from a thread's effective model override. */
  botSettings?: BotConfiguration;
  botAvatarSupported?: boolean;
  /** File memory is available only in the capable desktop Bot workspace. */
  botMemory?: ReactNode;
  botRuntime?: ReactNode;
  botActivity?: ReactNode;
  botAutomation?: ReactNode;
  botManagement?: ReactNode;
  botDelegations?: ReactNode;
  renderBotDelegation?: (delegationId: string, revision: number) => ReactNode;
  /** Desktop-only managed threads still allow approval and question responses. */
  botReadOnlyReason?: string;
  /** Opens a sent file with its bytes reader and independent conversation cache scope. */
  onOpenAttachment?: (file: RemoteAttachment, read: () => Promise<string>, cacheScope?: string) => void;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const client = useMemo(
    () =>
      new BotClient(
        cacheKey,
        rpc,
        typeof localStorage === "undefined" ? undefined : localStorage,
      ),
    [cacheKey, rpc],
  );
  const readImage = useCallback((messageId: string, file: RemoteAttachment) =>
    client.readImage(messageId, file), [client]);
  const openAttachment = useMemo(() => onOpenAttachment
    ? (messageId: string, file: RemoteAttachment) =>
        onOpenAttachment(file, () => client.readAttachment(messageId, file), cacheKey)
    : undefined, [client, onOpenAttachment, cacheKey]);
  // Undefined means the first sync is pending; null confirms setup is needed.
  const [assistant, setAssistant] = useState<BotConfiguration | null>();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  useEffect(() => {
    if (!visible) return;
    const markRead = () => {
      if (document.visibilityState !== "hidden" && (!botsLayout || followLog.current))
        markBotRead(cacheKey, messages);
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [cacheKey, messages, visible]);
  const visibleMessages = useMemo(
    () => chrome ? compactBotTimeline(messages) : messages,
    [messages, chrome],
  );
  // Only the newest rows render at first. Older ones join as the reader
  // nears the top, so cost follows what is read, not the history's length.
  const [historyRows, setHistoryRows] = useState(INITIAL_HISTORY_ROWS);
  const [remoteHistory, setRemoteHistory] = useState(false);
  const renderedMessages = useMemo(
    () => historyRows >= visibleMessages.length
      ? visibleMessages
      : visibleMessages.slice(-historyRows),
    [visibleMessages, historyRows],
  );
  const hasOlderHistory = remoteHistory || historyRows < visibleMessages.length;
  // The loader sits above the oldest row for as long as older history
  // remains, usually scrolled away; its spinner only needs to run in view.
  const pauseOffscreen = usePauseOffscreenAnimation<HTMLDivElement>();
  const growingHistory = useRef(false);
  const showOlderHistory = useCallback(() => {
    if (growingHistory.current) return;
    growingHistory.current = true;
    const rows = historyRows + HISTORY_ROW_STEP;
    if (rows <= visibleMessages.length || !client.hasOlderHistory) {
      startTransition(() => setHistoryRows(rows));
      return;
    }
    void client.loadOlder().then((entries) => {
      startTransition(() => {
        setMessages(entries);
        setRemoteHistory(client.hasOlderHistory);
        setHistoryRows(rows);
      });
    }, (e) => {
      growingHistory.current = false;
      setError(botErrorMessage(e));
    });
  }, [client, historyRows, visibleMessages.length]);
  useEffect(() => {
    growingHistory.current = false;
  }, [historyRows]);
  const pendingUserMessageId = useMemo(
    () => visibleMessages.reduce<string | undefined>(
      (latest, message) => message.kind === "user"
        ? message.id
        : message.kind === "assistant" ? undefined : latest,
      undefined,
    ),
    [visibleMessages],
  );
  const replies = useMemo(
    () =>
      messages.flatMap((message) =>
        message.kind === "assistant"
          ? [{ id: message.id, text: message.text }]
          : [],
      ),
    [messages],
  );
  const renderingPlatform = useTranscriptRenderingPlatform(replies, {
    // An empty first sync is still loaded history; the first new reply animates.
    historyReady: assistant !== undefined,
    historyIds: client.historyMessageIds,
  });
  const [catalog, setCatalog] = useState<HostModelCatalog>({
    models: {},
    errors: {},
  });
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [supported, setSupported] = useState<boolean>();
  const [botsShellSupported, setBotsShellSupported] = useState(false);
  const mobile = !!chrome;
  const botsLayout = desktopBots && !mobile && botsShellSupported;
  const composerReadOnly = botsLayout ? botReadOnlyReason : undefined;
  // Personality, local time and promised follow-ups need a newer Host.
  const [personaSupported, setPersonaSupported] = useState(false);
  const [imSupported, setImSupported] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBase, setSettingsBase] = useState<BotConfiguration | null>(null);
  const retainedSettingsDraft = useRef(false);
  const settingsCommand = useRef<{ signature: string; id: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  // Initial connection failures replace the loading state with a retry.
  const [connectError, setConnectError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [catalogState, setCatalogState] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [catalogError, setCatalogError] = useState<string>();
  const catalogLoad = useMemo(() => ({ requested: false, disposed: false }), [client]);
  useEffect(() => {
    catalogLoad.disposed = false;
    return () => { catalogLoad.disposed = true; };
  }, [catalogLoad]);
  const [draft, setDraft] = useBotDraft(cacheKey);
  const [retry, setRetry] = useState(() => client.pending());
  const [replyText, setReplyText] = useState<string | undefined>(() => {
    if (!chrome) return;
    try {
      return localStorage.getItem(`monocode.assistant-reply:${cacheKey}`) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const cancelReply = useCallback(() => setReplyText(undefined), []);
  const [attachments, setAttachments] = useState<BotDraftAttachment[]>([]);
  const uploading = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLElement>(null);
  const followLog = useRef(true);
  const lastScrollTop = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [readThrough, setReadThrough] = useState(() => botReadRevision(cacheKey));
  const latestRevision = messages.reduce((latest, message) => Math.max(latest, message.revision), 0);
  const newMessages = botsLayout ? messages.filter(message => message.kind === "assistant" && message.revision > readThrough) : [];
  const retainedNewCount = useRef(0);
  if (newMessages.length) retainedNewCount.current = newMessages.length;
  useEffect(() => {
    if (botsLayout && visible && followLog.current) setReadThrough(latestRevision);
  }, [botsLayout, visible, latestRevision]);
  const jumpToLatest = () => {
    followLog.current = true; setAwayFromBottom(false); setReadThrough(latestRevision);
    markBotRead(cacheKey, messages);
    log.current?.scrollTo?.({ top: log.current.scrollHeight, behavior: reducedMotionQuery().matches ? "instant" : "smooth" });
  };
  useEffect(() => {
    if (!botsLayout || !visible || !chat.current || typeof ResizeObserver === "undefined") return;
    let previous = chat.current.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = chat.current?.clientWidth ?? previous;
      if (previous >= 1050 && width < 1050) setSettingsOpen(false);
      previous = width;
    });
    observer.observe(chat.current);
    return () => observer.disconnect();
  }, [botsLayout, visible]);
  const [worker, setWorker] = useState<SessionReference>();
  const [workerOpen, setWorkerOpen] = useState(false);
  const canRead = (ref: SessionReference, current = assistant) =>
    !!current?.policy?.permissions["sessions.read"] &&
    (current.policy.allowedProjects === "all" ||
      current.policy.allowedProjects.includes(ref.projectId));
  useEffect(() => {
    if (worker && !canRead(worker)) setWorkerOpen(false);
  }, [assistant, worker]);
  const sync = useCallback(async () => {
    const result = await client.sync({ fresh: true });
    setAssistant(result.assistant);
    setMessages(result.messages);
    setRemoteHistory(client.hasOlderHistory);
  }, [client]);
  useEffect(() => {
    if (!visible) return;
    let disposed = false,
      fetching = false,
      capable = false,
      historySupported = false,
      synchronized = assistant !== undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshDelay = 2000;
    setConnectError(undefined);
    const refresh = async () => {
      if (fetching || disposed) return;
      fetching = true;
      try {
        const next = await client.sync({ history: historySupported });
        if (disposed) return;
        synchronized = true;
        setConnectError(undefined);
        setAssistant(next.assistant);
        setMessages(next.messages);
        setRemoteHistory(client.hasOlderHistory);
        refreshDelay = next.assistant?.lifecycle === "running" ? 250 : 2000;
      } catch (e) {
        if (!disposed) {
          if (synchronized) setError(botErrorMessage(e));
          else setConnectError(botErrorMessage(e));
        }
      } finally {
        fetching = false;
        if (!disposed && capable)
          timer = setTimeout(() => void refresh(), refreshDelay);
      }
    };
    void rpc<HostDescriptor>("environment.describe", {
      supportedProviders: REMOTE_PROVIDERS,
    })
      .then(async (descriptor) => {
        if (disposed) return;
        const available =
          descriptor.capabilities?.includes("assistant.v1") ?? false;
        setSupported(available);
        setBotsShellSupported(descriptor.capabilities?.includes("bots.shell.v1") ?? false);
        setPersonaSupported(
          descriptor.capabilities?.includes("assistant.persona") ?? false,
        );
        setImSupported(descriptor.capabilities?.includes("im.feishu.v1") ?? false);
        if (!available) return;
        capable = true;
        historySupported = descriptor.capabilities?.includes("assistant.history") ?? false;
        await refresh();
      })
      .catch((e) => {
        if (!disposed) setConnectError(botErrorMessage(e));
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [client, rpc, attempt, visible]);
  const loadCatalog = useCallback(async () => {
    catalogLoad.requested = true;
    setCatalogState("loading");
    setCatalogError(undefined);
    try {
      const [models, projects] = await Promise.all([
        rpc<HostModelCatalog>("models.list"),
        rpc<HostProject[]>("projects.list"),
      ]);
      if (catalogLoad.disposed) return;
      setCatalog(models);
      setProjects(projects);
      setCatalogState("ready");
    } catch (e) {
      if (catalogLoad.disposed) return;
      setCatalogError(botErrorMessage(e));
      setCatalogState("failed");
    }
  }, [rpc, catalogLoad]);
  // A normal chat does not need model discovery or the project catalog.
  // Keep those RPCs off the entry path until setup or settings are shown.
  useEffect(() => {
    if (visible && supported === true && (settingsOpen || assistant === null) && !catalogLoad.requested)
      void loadCatalog();
  }, [visible, supported, settingsOpen, assistant === null, catalogLoad, loadCatalog]);
  const loadSessions = useCallback(
    async (projectIds: string[]) => {
      const lists = await Promise.all(
        projectIds.map((projectId) =>
          rpc<HostSessionSummary[]>("sessions.list", {
            projectId,
          }).then(
            (rows) =>
              rows.map((row) => ({
                id: row.id,
                title: row.title || row.id,
                harness: row.harness,
                projectId,
                activityAt:
                  row.activityAt ?? row.lastUserMessageAt ?? row.createdAt,
              })),
          ),
        ),
      );
      return lists.flat();
    },
    [rpc],
  );
  useEffect(() => {
    if (!chrome) return;
    try {
      const key = `monocode.assistant-reply:${cacheKey}`;
      if (replyText === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, replyText);
    } catch {
      /* The reply remains usable without persistent storage. */
    }
  }, [cacheKey, chrome, replyText]);
  // WebKit has no scroll anchoring, and rows outside the viewport only
  // estimate their height. Keep the row the reader is on where they saw it
  // whenever older rows join or anything above it changes size.
  const anchor = useRef<ReadingAnchor | undefined>(undefined);
  const firstRenderedId = renderedMessages[0]?.id;
  const previousFirstId = useRef(firstRenderedId);
  useLayoutEffect(() => {
    const element = log.current;
    const prepended = previousFirstId.current !== undefined &&
      previousFirstId.current !== firstRenderedId;
    previousFirstId.current = firstRenderedId;
    if (!element) return;
    if (prepended) {
      if (followLog.current || !anchor.current)
        element.scrollTop = followScrollTop(element, !!chrome);
      else restoreReadingAnchor(element, anchor.current);
      anchor.current = readingAnchor(element);
    }
    // A short page has no scrollbar to reach the top with; fill it first.
    if (
      visible &&
      hasOlderHistory &&
      element.scrollHeight - element.clientHeight < HISTORY_LOAD_DISTANCE
    )
      showOlderHistory();
  }, [firstRenderedId, chrome, visible, hasOlderHistory, showOlderHistory]);
  useLayoutEffect(() => {
    if (!visible) return;
    syncHeaderHeight(chat.current, !!chrome);
    const element = log.current;
    if (followLog.current && element)
      element.scrollTo?.({ top: followScrollTop(element, !!chrome) });
  }, [messages, chrome, visible]);
  // Once the Host has recorded a sent message and the log has followed it,
  // the message scrolls in with the rows above it.
  const launch = useRef<number>(undefined);
  const latestUserId = useMemo(() => {
    for (let i = renderedMessages.length - 1; i >= 0; i--)
      if (renderedMessages[i].kind === "user") return renderedMessages[i].id;
  }, [renderedMessages]);
  const seenUserId = useRef(latestUserId);
  useLayoutEffect(() => {
    if (seenUserId.current === latestUserId) return;
    seenUserId.current = latestUserId;
    const pending = launch.current;
    launch.current = undefined;
    const element = log.current;
    if (
      pending === undefined ||
      !element ||
      !visible ||
      !followLog.current ||
      performance.now() - pending > LAUNCH_TTL_MS
    )
      return;
    if (reducedMotionQuery().matches) return;
    const users = element.querySelectorAll<HTMLElement>(".assistant-message-row-user");
    const row = users[users.length - 1];
    const bubble = row?.querySelector<HTMLElement>(".assistant-message-user");
    if (!row || !bubble || typeof bubble.animate !== "function") return;
    const view = element.getBoundingClientRect();
    const landed = row.getBoundingClientRect();
    // The new row pushed everything above it up by its height and gap.
    const others = [...element.children].filter(
      (other): other is HTMLElement =>
        other instanceof HTMLElement && !other.contains(row),
    );
    const above = others
      .map((other) => other.getBoundingClientRect().bottom)
      .filter((bottom) => bottom <= landed.top + 0.5);
    const distance = above.length
      ? landed.bottom - Math.max(...above)
      : landed.height;
    const earlier = others.filter((other) => {
      const rect = other.getBoundingClientRect();
      return rect.bottom <= landed.top + 0.5 && rect.bottom + distance > view.top;
    });
    return slidePromptIn([bubble], distance, earlier)?.release;
  }, [latestUserId, visible]);
  useEffect(() => {
    const element = log.current;
    if (!visible || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      syncHeaderHeight(chat.current, !!chrome);
      if (followLog.current)
        element.scrollTo?.({ top: followScrollTop(element, !!chrome) });
      else anchor.current = restoreReadingAnchor(element, anchor.current);
    });
    observer.observe(element);
    // Markdown grows between RPC updates while characters are being revealed.
    for (const child of element.children) observer.observe(child);
    // Keep the observer across streaming revisions. Only actual row insertion
    // or removal changes its targets; Markdown growth is handled by resize.
    const children = new MutationObserver((records) => {
      for (const record of records) {
        for (const child of record.removedNodes)
          if (child instanceof Element) observer.unobserve?.(child);
        for (const child of record.addedNodes)
          if (child instanceof Element) observer.observe(child);
      }
    });
    children.observe(element, { childList: true });
    const header = chat.current?.querySelector(chrome
      ? ".mobile-assistant-header > .mobile-header-title"
      : ".assistant-header");
    if (header) observer.observe(header);
    return () => {
      children.disconnect();
      observer.disconnect();
    };
  }, [!!assistant, chrome, visible, supported, !!connectError]);
  const operation = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await sync();
    } catch (e) {
      setError(botErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [sync]);
  const send = (text: string, files: BotDraftAttachment[] = attachments) => {
    if (composerReadOnly) return Promise.resolve();
    return operation(async () => {
      setSending(true);
      try {
        followLog.current = true;
        await client.send(text, files.map(({ previewFile: _preview, ...ref }) => ref));
        chrome?.onSendFeedback?.(true);
        setRetry(undefined);
        setDraft("");
        setReplyText(undefined);
        setAttachments([]);
      } catch (error) {
        chrome?.onSendFeedback?.(false);
        throw error;
      } finally {
        setSending(false);
        setRetry(client.pending());
      }
    });
  };
  const save = async (patch: BotPatch) =>
    operation(async () => {
      // Failures stay inline in the settings panel, beside Reload settings.
      const signature = JSON.stringify([cacheKey, settingsBase?.revision ?? 0, patch]);
      if (botsLayout && settingsCommand.current?.signature !== signature)
        settingsCommand.current = { signature, id: crypto.randomUUID() };
      await withStatusToast(
        () =>
          rpc("assistant.configure", {
            commandId: botsLayout ? settingsCommand.current!.id : crypto.randomUUID(),
            expectedRevision: settingsBase?.revision ?? 0,
            patch,
          }),
        {
          loading: t("Saving assistant settings…"),
          success: t(
            settingsBase ? "Assistant settings saved" : "Assistant enabled",
          ),
          error: false,
        },
      );
      settingsCommand.current = undefined;
      retainedSettingsDraft.current = false;
      setSettingsOpen(false);
    });
  const open = useCallback(async (ref: SessionReference) => {
    setError(undefined);
    try {
      const current = await rpc<BotConfiguration | null>("assistant.get");
      if (!current?.policy.permissions["sessions.read"] ||
        (current.policy.allowedProjects !== "all" && !current.policy.allowedProjects.includes(ref.projectId)))
        throw new Error(
          "This conversation is outside the assistant's current permissions.",
        );
      const target = await resolveBotTarget(hostKey, ref, rpc);
      if (target.session.session.orchestrationLeadId) {
        setWorker(ref);
        setWorkerOpen(true);
      } else await onOpen(ref, target);
    } catch (e) {
      setError(botErrorMessage(e));
    }
  }, [hostKey, rpc, onOpen]);
  const labels = {
    idle: "Ready",
    running: "Working",
    paused: "Paused",
    backoff: "Retrying later",
    interrupted: "Interrupted",
    failed: "Failed",
    disabled: "Disabled",
  };
  const continuable =
    !!assistant &&
    ["paused", "interrupted", "failed", "disabled"].includes(
      assistant.lifecycle,
    );
  const controls: BotControlsProps | undefined = assistant
    ? {
        busy,
        enabled: assistant.enabled,
        continuable,
        onToggle: () =>
          void operation(() =>
            rpc("assistant.control", {
              commandId: crypto.randomUUID(),
              action: continuable ? "resume" : "pause",
              expectedGeneration: assistant.brainGeneration,
            }),
          ),
        onDisable: () =>
          void operation(() =>
            rpc("assistant.control", {
              commandId: crypto.randomUUID(),
              action: "disable",
              expectedGeneration: assistant.brainGeneration,
            }),
          ),
        nextRetryAt: assistant.nextRetryAt,
        backlog: assistant.backlog,
      }
    : undefined;
  const openSettings = () => {
    if (!botsLayout || !retainedSettingsDraft.current) {
      setSettingsBase(botSettings ?? assistant ?? null);
      retainedSettingsDraft.current = true;
    }
    setSettingsOpen((v) => !v);
  };
  const attachDisabled = !!composerReadOnly || busy || !!retry || !assistant?.enabled || !assistant.triggers.user;
  const attach = (source: File[] | (() => Promise<File[]>)) => {
    if (attachDisabled || uploading.current) return;
    uploading.current = true;
    void operation(async () => {
      try {
        const files = typeof source === "function" ? await source() : source;
        if (attachments.length + files.length > 20)
          throw new Error("At most 20 attachments are allowed");
        for (const file of files) {
          const ref = await client.upload(file);
          setAttachments((a) => [...a, {
            ...ref,
            ...(ref.kind === "image" ? { previewFile: file } : {}),
          }]);
        }
      } finally {
        uploading.current = false;
      }
    });
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      attach(files);
    } else if (!chrome && isTauri() && !event.clipboardData.getData("text/plain")) {
      event.preventDefault();
      attach(async () => [await readClipboardImage()]);
    }
  };
  const drop = (event: DragEvent<HTMLFormElement>) => {
    const files = filesFromClipboard(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    attach(files);
  };
  const activity = botActivityLabel(assistant?.activity);
  const workingLabel = t(activity.key, activity.params);
  const ui = chrome ?? (botsLayout ? desktopBotsChrome : desktopBotsLegacyChrome);
  const replying = mobile && replyText !== undefined;
  const { Header, SettingsPanel, Controls, Composer, Feedback } = ui;
  const settingsShown = supported === true && (settingsOpen || assistant === null);
  const settingsCovering = settingsShown && (!botsLayout || assistant === null);
  const detailsMotion = useCollapseMotion(botsLayout && settingsShown);
  const replyMenu = useBotReplyMenu(
    mobile,
    visible && !!assistant && !settingsCovering && !replying,
  );
  const MessageMenu = ui.MessageMenu ?? DesktopBotsMessageMenu;
  const replyDisabled =
    !!composerReadOnly || busy || !!retry || !assistant?.enabled || !assistant.triggers.user;
  const reply = (text: string) => {
    if (replyDisabled) return;
    // Let the menu restore its previous focus before opening the mobile keyboard.
    flushSync(() => {
      if (mobile) setReplyText(text);
      else setDraft((previous) => `${quoteBotReply(text)}\n\n${previous}`);
      replyMenu.close();
    });
    const input = chat.current?.querySelector<HTMLTextAreaElement>(
      ".assistant-conversation textarea",
    );
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  };
  useBotMessageSwipe({
    log,
    active: mobile && visible && !!assistant && !settingsCovering && !replyMenu.menu && !replying,
    replyDisabled,
    cancelHold: replyMenu.cancelHold,
    onReply: (id) => {
      const message = visibleMessages.find((message) => message.id === id);
      if (message?.kind === "assistant") reply(message.text);
    },
  });
  const errorNotice = (error || assistant?.error) && (
    <ComposerNotice
      className="assistant-error"
      actions={settingsOpen ? (
        <ComposerNoticeButton
          onClick={() => {
            setSettingsBase(botSettings ?? assistant ?? null);
            setError(undefined);
          }}
        >
          {t("Reload settings")}
        </ComposerNoticeButton>
      ) : !error && continuable && controls ? (
        <ComposerNoticeButton disabled={busy} onClick={controls.onToggle}>
          {t("Continue")}
        </ComposerNoticeButton>
      ) : null}
      onDismiss={!settingsOpen && error ? () => setError(undefined) : undefined}
      dismissLabel={t("Dismiss")}
    >
      {t(error ?? assistant!.error!)}
    </ComposerNotice>
  );
  const respond = useCallback((
    message: Extract<BotMessage, { kind: "input" }>,
    answer: object,
  ) =>
    void operation(() =>
      rpc("assistant.respond", {
        commandId: crypto.randomUUID(),
        messageId: message.id,
        brainGeneration: message.brainGeneration,
        runId: message.runId,
        requestId: message.requestId,
        ...answer,
      }),
    ), [operation, rpc]);
  // Polling returns fresh view objects even when access policy is unchanged.
  const allowedProjectsKey = JSON.stringify(assistant?.policy.allowedProjects);
  const messageProjects = useMemo(() => assistant?.policy.allowedProjects, [allowedProjectsKey]);
  return (
    <TranscriptPlatformContext.Provider value={renderingPlatform}>
      {Feedback && <Feedback messages={messages} historyIds={client.historyMessageIds}
        active={visible && !!assistant && !settingsCovering && !replyMenu.menu}
        busy={assistant?.lifecycle === "running"} scope={hostKey} />}
      <section
        ref={chat}
        className={`assistant-chat bg-background-base text-content${botsLayout ? " desktop-bots-workspace animated-collapse-size" : ""}`}
        aria-label={t(botsLayout ? "Bots" : "Assistant")}
        data-layout={mobile ? "mobile" : "desktop"}
        data-bot-details={botsLayout ? settingsShown : undefined}
        data-fold-state={botsLayout ? detailsMotion.foldState : undefined}

      >
        {botsLayout && (botNavigation ?? (
          <DesktopBotsNavigation
            hostName={hostName}
            assistant={assistant}
            messages={messages}
            onSelect={() => chat.current?.querySelector<HTMLTextAreaElement>(".assistant-conversation textarea")?.focus()}
          />
        ))}
        <div
          className="assistant-heading"
          inert={settingsCovering}
          aria-hidden={settingsCovering || undefined}
        >
          <Header
            name={assistant?.name ?? t("Assistant")}
            threadTitle={threadTitle}
            botIdentity={botsLayout && assistant ? botSettings ?? assistant : undefined}
            threadPicker={botsLayout ? botThreadPicker : undefined}
            harness={assistant?.harness}
            hostName={hostName}
            status={
              assistant
                ? t(labels[assistant.lifecycle])
                : t(assistant === null ? "Set up assistant" : "Connecting…")
            }
            lifecycle={assistant?.lifecycle}
            activity={assistant?.lifecycle === "running" ? workingLabel : undefined}
            settingsOpen={settingsOpen}
            busy={busy}
            onSettings={assistant ? openSettings : undefined}
            onClose={onClose}
            controls={controls}
          />
        </div>
        <div
          className="assistant-details"
          inert={settingsCovering}
          aria-hidden={settingsCovering || undefined}
        >
          <AnimatedCollapse expanded={workerOpen}>
            {worker && (
              <BotWorkerDetails
                target={worker}
                rpc={rpc}
                active={workerOpen && canRead(worker)}
                onClose={() => setWorkerOpen(false)}
              />
            )}
          </AnimatedCollapse>
        </div>
        {!settingsCovering &&
          (connectError || supported !== true || !assistant || !controls) &&
          errorNotice}
        {connectError ? (
          <div className="assistant-availability" role="alert">
            <p>{t(connectError)}</p>
            <div className="assistant-availability-actions">
              <button data-ui="button" data-variant="primary"
                type="button"
                className="assistant-primary"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("Retry")}
              </button>
              {onClose && (
                <button type="button" onClick={onClose}>
                  {t("Close")}
                </button>
              )}
            </div>
          </div>
        ) : supported === false ? (
          <p className="assistant-availability" role="status">
            {t("Assistant is unavailable on this Host")}
          </p>
        ) : supported === undefined || assistant === undefined ? (
          <div className="assistant-availability assistant-loading" role="status">
            <Loader2 className="assistant-loading-spinner" size={22} aria-hidden="true" />
            <span>{t(supported ? "Loading messages…" : "Connecting…")}</span>
          </div>
        ) : (
          <motionElement.div
      initial={false} animate={botsLayout ? { gridTemplateColumns: settingsShown ? "minmax(0, 1fr) minmax(0, var(--bots-inspector-width))" : "minmax(0, 1fr) minmax(0, 0px)" } : undefined} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={detailsMotion.finish}
            className={`assistant-body${botsLayout ? " animated-collapse-size" : ""}`}
            data-bot-details={botsLayout ? settingsShown : undefined}
            data-bot-setup={botsLayout && !assistant || undefined}
          >
            <SettingsPanel
              open={settingsShown}
              initialSetup={!assistant}
              onClose={() => (assistant ? setSettingsOpen(false) : onClose?.())}
            >
              {settingsShown && errorNotice}
              <DesktopBotDetails
                identity={botsLayout && settingsBase ? <BotIdentitySettings key={`${cacheKey}:${settingsBase.revision}`} bot={settingsBase} avatarSupported={botAvatarSupported} busy={busy} onSave={save}>{botPinControl}</BotIdentitySettings> : undefined}
                delegations={botsLayout ? botDelegations : undefined}
                memory={botsLayout ? botMemory : undefined}
                runtime={botsLayout ? botRuntime : undefined}
                activity={botsLayout ? botActivity : undefined}
                automation={botsLayout ? botAutomation : undefined}
                management={botsLayout ? botManagement : undefined}
              >
              <BotSettings
                key={`${cacheKey}:${settingsBase?.revision ?? "new"}`}
                panel={botsLayout && botAutomation ? "settings" : "all"}
                value={settingsBase}
                catalog={catalog}
                catalogState={catalogState}
                catalogError={catalogError}
                onRetryCatalog={() => void loadCatalog()}
                loadSessions={loadSessions}
                projects={projects}
                busy={busy}
                onSave={save}
                onCancel={
                  mobile || !assistant || botsLayout
                    ? undefined
                    : () => setSettingsOpen(false)
                }
                mobile={mobile}
                Select={ui.Select}
                MemoryDetail={ui.MemoryDetail}
                Actions={ui.SettingsActions}
                personaSupported={personaSupported}
                im={{
                  rpc,
                  supported: imSupported,
                  active: settingsShown && visible,
                  assistantEnabled: assistant?.enabled ?? false,
                }}
                reminders={assistant?.reminders}
                memory={
                  assistant?.memory && { rpc, ...assistant.memory }
                }
                habits={
                  assistant?.habits && {
                    items: assistant.habits,
                    timeZone: assistant.timezone ?? "UTC",
                    control: async (input) => {
                      await rpc("assistant.control", {
                        commandId: crypto.randomUUID(),
                        ...input,
                      });
                      // The change is in; polling catches up if this refresh fails.
                      await sync().catch(() => {});
                    },
                  }
                }
                onCancelReminder={
                  personaSupported
                    ? (reminderId) =>
                        operation(() =>
                          rpc("assistant.control", {
                            commandId: crypto.randomUUID(),
                            action: "cancelReminder",
                            reminderId,
                          }),
                        )
                    : undefined
                }
              />
              </DesktopBotDetails>
            </SettingsPanel>
            {assistant && controls && (
              <div
                className="assistant-conversation"
                inert={settingsCovering}
                aria-hidden={settingsCovering || undefined}
              >
                <Controls {...controls} />
                {botsLayout && <AnimatedCollapse expanded={awayFromBottom && newMessages.length > 0} className="desktop-bots-new-messages">
                  <div><button type="button" onClick={jumpToLatest}><ArrowUp size={14} />{t("{count} new messages", { count: retainedNewCount.current })}</button><button type="button" aria-label={t("Dismiss")} onClick={() => setReadThrough(latestRevision)}><X size={13} /></button></div>
                </AnimatedCollapse>}
                <div
                  ref={log}
                  className="assistant-messages"
                  inert={replying}
                  aria-hidden={replying || undefined}
                  role="log"
                  data-follow-latest={followLog.current}
                  aria-label={t("Assistant messages")}
                  onScroll={() => {
                    replyMenu.cancelHold();
                    const element = log.current;
                    if (element) {
                      if (
                        hasOlderHistory &&
                        element.scrollTop < HISTORY_LOAD_DISTANCE
                      )
                        showOlderHistory();
                      const gap = Math.abs(
                        element.scrollTop -
                          (mobile
                            ? followScrollTop(element, true)
                            : element.scrollHeight - element.clientHeight),
                      );
                      // Leaving the latest row upwards stops following at
                      // once; otherwise a resize inside the snap distance
                      // pulls the reader back down while they scroll up.
                      const movedUp = element.scrollTop < lastScrollTop.current - 0.5;
                      lastScrollTop.current = element.scrollTop;
                      followLog.current = gap < 1 || (gap < 60 && !movedUp);
                      element.dataset.followLatest = String(followLog.current);
                      if (botsLayout) {
                        setAwayFromBottom(!followLog.current);
                        if (followLog.current) { setReadThrough(latestRevision); markBotRead(cacheKey, messages); }
                      }
                      anchor.current = readingAnchor(element);
                    }
                  }}
                >
                  {!messages.length && (
                    <div className="assistant-welcome mobile-assistant-welcome">
                      <span aria-hidden="true">
                        <Sparkles size={28} />
                      </span>
                      <h2>{t("How can I help?")}</h2>
                      <p>
                        {t(
                          "Ask me to check progress, start a task, or follow up with your agents.",
                        )}
                      </p>
                    </div>
                  )}
                  {hasOlderHistory && (
                    <div
                      ref={pauseOffscreen}
                      className="assistant-history-loading"
                      role="status"
                    >
                      <Loader2
                        className="assistant-loading-spinner"
                        size={16}
                        aria-hidden="true"
                      />
                      <span>{t("Loading earlier messages…")}</span>
                    </div>
                  )}
                  <BotMessages
                    botsLayout={botsLayout}
                    renderFile={botsLayout ? (messageId, file) => <BotAttachmentCard file={file} read={() => client.readAttachment(messageId, file)} onOpen={openAttachment ? () => openAttachment(messageId, file) : undefined} /> : undefined}
                    renderBotDelegation={botsLayout ? renderBotDelegation : undefined}
                    readImage={readImage}
                    onOpenAttachment={openAttachment}
                    messages={renderedMessages}
                    pendingUserMessageId={pendingUserMessageId}
                    canRead={!!assistant.policy.permissions["sessions.read"]}
                    allowedProjects={messageProjects}
                    mobile={mobile}
                    busy={busy}
                    onOpen={open}
                    onRespond={respond}
                    bindReply={replyMenu.bind}
                  />
                  {!mobile && assistant.lifecycle === "running" &&
                    !messages.some(
                      (message) =>
                        message.kind === "assistant" && message.streaming,
                    ) && (
                      <div className="assistant-working" role="status">
                        <Shimmer>{workingLabel}</Shimmer>
                      </div>
                    )}
                </div>
                {mobile && (
                  <button
                    type="button"
                    className="mobile-assistant-reply-backdrop"
                    data-active={replying}
                    aria-label={t("Cancel reply")}
                    aria-hidden={!replying || undefined}
                    tabIndex={-1}
                    disabled={!replying}
                    onClick={cancelReply}
                  />
                )}
                {botsLayout && <AnimatedCollapse expanded={awayFromBottom} className="desktop-bots-jump"><button type="button" aria-label={t("Scroll to bottom")} title={t("Scroll to bottom")} onClick={jumpToLatest}><ArrowUp size={18} style={{ transform: "rotate(180deg)" }} /></button></AnimatedCollapse>}
                <Composer
                  placeholder={botsLayout ? t("Message {bot}", { bot: assistant.name }) : undefined}
                  draft={draft}
                  errorNotice={composerReadOnly ? <>
                    <ComposerNotice tone="info" role="status" className="desktop-bot-read-only">{t(composerReadOnly)}</ComposerNotice>
                    {!settingsShown ? errorNotice : undefined}
                  </> : !settingsShown ? errorNotice : undefined}
                  replyText={mobile ? replyText : undefined}
                  onCancelReply={cancelReply}
                  onDraftChange={setDraft}
                  attachments={attachments}
                  busy={busy}
                  sending={sending}
                  inputDisabled={!!composerReadOnly || !assistant.enabled || !assistant.triggers.user}
                  attachDisabled={attachDisabled}
                  sendDisabled={
                    !!composerReadOnly || busy ||
                    (!draft.trim() && !attachments.length) ||
                    !assistant.enabled ||
                    !assistant.triggers.user ||
                    !!retry
                  }
                  retry={!composerReadOnly && !!retry}
                  onStop={
                    !composerReadOnly && assistant.lifecycle === "running"
                      ? () =>
                          void operation(() =>
                            rpc("assistant.control", {
                              commandId: crypto.randomUUID(),
                              action: "cancelTurn",
                              expectedGeneration: assistant.brainGeneration,
                            }),
                          )
                      : undefined
                  }
                  onRetry={() => {
                    if (retry) void send(retry.text, retry.attachments);
                  }}
                  onAttach={attach}
                  onPaste={paste}
                  onDrop={drop}
                  onRemoveAttachment={(id) =>
                    setAttachments((a) => a.filter((f) => f.id !== id))
                  }
                  onSend={() => {
                    launch.current = performance.now();
                    void send(replying ? `${quoteBotReply(replyText)}\n\n${draft}` : draft);
                  }}
                />
              </div>
            )}
          </motionElement.div>
        )}
        <MessageMenu
          open={!!replyMenu.menu}
          point={replyMenu.menu}
          text={replyMenu.menu?.text}
          replyable={replyMenu.menu?.replyable}
          disabled={replyDisabled}
          onReply={() => {
            if (replyMenu.menu?.replyable) reply(replyMenu.menu.text);
          }}
          onClose={replyMenu.close}
        />
      </section>
    </TranscriptPlatformContext.Provider>
  );
}
