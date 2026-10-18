import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotMemoryChange, BotMemoryDocument, BotMemoryKind, BotMemoryList } from "../model/botMemory";
import { BotMemoryDrafts } from "../model/botMemoryDrafts";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";

const kinds: [BotMemoryKind, string][] = [["soul", "Identity"], ["resident", "Resident memory"], ["topic", "Topics"], ["archive", "Archive"], ["log", "Logs"], ["playbook", "Playbooks"]];
const isConflict = (error: unknown) => (error as { code?: string })?.code === "MEMORY_CONFLICT"
  || /MEMORY_CONFLICT|changed elsewhere/i.test(botErrorMessage(error));

export function DesktopBotMemory({ botId, rpc, drafts }: { botId: string; rpc: BotRpc; drafts: BotMemoryDrafts }) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const state = useSyncExternalStore(drafts.subscribe, () => drafts.get(botId));
  const [files, setFiles] = useState<BotMemoryList>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<BotMemoryChange[]>();
  const [historyError, setHistoryError] = useState<string>();
  const [newTopic, setNewTopic] = useState(false);
  const [topic, setTopic] = useState("");
  const path = state.path;
  const currentPath = useRef(path);
  currentPath.current = path;
  const historyRequest = useRef(0);
  const draft = state.drafts[path];
  const dirty = !!draft && draft.text !== draft.base.text;
  const read = useCallback(async (path: string) => {
    const doc = await rpc<BotMemoryDocument>("botMemory.read", { botId, path });
    drafts.draft(botId, path, (current) => {
      if (current?.busy) return current;
      if (current && current.base.revision > doc.revision) return current;
      if (current && current.text !== current.base.text) return current.base.hash === doc.hash && current.base.revision === doc.revision
        ? current : { ...current, latest: doc, conflict: true };
      return { base: doc, text: doc.text };
    });
    return doc;
  }, [botId, rpc, drafts]);
  const list = useCallback(async () => setFiles(await rpc<BotMemoryList>("botMemory.list", { botId })), [botId, rpc]);
  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { await Promise.all([list(), read(path)]); }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setLoading(false); }
  }, [list, read, path]);
  useEffect(() => { if (visible) void load(); }, [visible, load]);
  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    setHistoryError(undefined);
    try {
      const result = await rpc<BotMemoryChange[]>("botMemory.log", { botId, path, limit: 30 });
      if (currentPath.current === path && historyRequest.current === request) setHistory(result);
    } catch (cause) {
      if (currentPath.current === path && historyRequest.current === request) setHistoryError(botErrorMessage(cause));
    }
  }, [botId, path, rpc]);
  useEffect(() => {
    setHistory(undefined);
    if (visible && historyOpen) void loadHistory();
  }, [visible, historyOpen, loadHistory]);
  const mutate = async (changeId?: string) => {
    const current = drafts.get(botId).drafts[path];
    if (!current || current.busy || current.conflict) return;
    if (changeId && (current.text !== current.base.text || !history?.some((change) => change.id === changeId && change.path === path))) return;
    const expected = { expectedRevision: current.base.revision, expectedHash: current.base.hash };
    const signature = JSON.stringify([changeId ?? "save", path, current.text, expected]);
    const command = current.command?.signature === signature ? current.command : { signature, id: crypto.randomUUID() };
    drafts.draft(botId, path, () => ({ ...current, command, busy: true, error: undefined }));
    try {
      const doc = await rpc<BotMemoryDocument>(changeId ? "botMemory.undo" : "botMemory.save", {
        botId, commandId: command.id, ...expected, ...(changeId ? { changeId } : { path, text: current.text }),
      });
      drafts.draft(botId, path, () => ({ base: doc, text: doc.text }));
      void list().catch(() => {});
      if (historyOpen) void loadHistory();
    } catch (cause) {
      const conflict = isConflict(cause);
      drafts.draft(botId, path, (value) => ({ ...value!, busy: false, conflict, error: conflict ? undefined : botErrorMessage(cause) }));
      if (conflict) {
        // Loading the competing version never replaces the local text.
        try {
          const latest = await rpc<BotMemoryDocument>("botMemory.read", { botId, path });
          drafts.draft(botId, path, (value) => ({ ...value!, latest }));
        } catch (error) { setError(botErrorMessage(error)); }
      }
    }
  };
  const openTopic = async () => {
    if (!topic.trim()) return;
    const next = `memory/${topic.trim().replace(/\.md$/i, "")}.md`;
    setLoading(true); setError(undefined);
    try {
      await read(next);
      drafts.update(botId, (value) => ({ ...value, path: next }));
      setNewTopic(false); setTopic("");
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setLoading(false); }
  };
  return <section className="desktop-bots-memory" aria-label={t("Memory files")}>
    <div className="desktop-bots-memory-toolbar">
      <label>{t("File")}<select data-ui="select" data-file-label aria-label={t("Memory file")} value={path} onChange={(event) => drafts.update(botId, (value) => ({ ...value, path: event.target.value }))}>
        {[...new Set([path, ...Object.keys(state.drafts)])].filter((item) => !files?.files.some((file) => file.path === item)).map((item) => <option key={item} value={item}>{item}</option>)}
        {kinds.map(([kind, label]) => {
          const items = files?.files.filter((file) => file.kind === kind) ?? [];
          return items.length ? <optgroup key={kind} label={t(label)}>{items.map((file) => <option key={file.path} value={file.path}>{file.path}{state.drafts[file.path]?.text !== undefined && state.drafts[file.path].text !== state.drafts[file.path].base.text ? ` • ${t("Unsaved changes")}` : ""}</option>)}</optgroup> : null;
        })}
      </select></label>
      <button type="button" onClick={() => setNewTopic((value) => !value)} aria-expanded={newTopic}>{t("New topic")}</button>
      <button type="button" disabled={loading || draft?.busy} onClick={() => void load()}>{t("Refresh")}</button>
    </div>
    <AnimatedCollapse expanded={newTopic}>
      <form className="desktop-bots-memory-new" onSubmit={(event) => { event.preventDefault(); void openTopic(); }}>
        <label>{t("Topic name")}<input data-ui="input" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={t("Topic name")} /></label>
        <button type="submit" disabled={loading || !topic.trim()}>{t("Open draft")}</button>
      </form>
    </AnimatedCollapse>
    {files?.topicsTruncated && <p role="status">{t("The topic index is limited to {count} files.", { count: files.topicLimit })}</p>}
    {error && <p className="desktop-bots-memory-error" role="alert">{t(error)}</p>}
    {draft ? <>
      {draft.base.budget && <div className="desktop-bots-memory-budget" data-truncated={draft.base.budget.truncated} role="status">
        <strong>{t(draft.base.budget.truncated ? "Memory is truncated in prompts" : "Memory fits the prompt budget")}</strong>
        <span>{t("{lines} / {maxLines} lines · {bytes} / {maxBytes} bytes loaded", { lines: draft.base.budget.loadedLines, maxLines: draft.base.budget.maxLines, bytes: draft.base.budget.loadedBytes, maxBytes: draft.base.budget.maxBytes })}</span>
        <span>{t("Full file: {lines} lines · {bytes} bytes", { lines: draft.base.budget.lines, bytes: draft.base.budget.bytes })}</span>
      </div>}
      <label className="desktop-bots-memory-editor-label"><span><span data-file-label>{path}</span>{dirty ? ` • ${t("Unsaved changes")}` : ""}</span>
        <textarea data-ui="textarea" aria-label={t("File contents")} value={draft.text} disabled={draft.busy} spellCheck={false}
          onChange={(event) => drafts.draft(botId, path, (value) => ({ ...value!, text: event.target.value, error: undefined }))} />
      </label>
      {draft.error && <p className="desktop-bots-memory-error" role="alert">{t(draft.error)}</p>}
      <AnimatedCollapse expanded={!!draft.conflict}>
        <div className="desktop-bots-memory-conflict" role="alert">
          <p>{t("This file changed elsewhere. Your draft is preserved.")}</p>
          {draft.latest ? <>
            <label>{t("Latest saved version")}<textarea data-ui="textarea" readOnly aria-label={t("Latest saved version")} value={draft.latest.text} /></label>
            <div className="desktop-bots-memory-actions">
              <button type="button" onClick={() => drafts.draft(botId, path, (value) => ({ base: value!.latest!, text: value!.latest!.text }))}>{t("Use latest version")}</button>
              <button type="button" onClick={() => drafts.draft(botId, path, (value) => ({ base: value!.latest!, text: value!.text }))}>{t("Keep draft over latest")}</button>
            </div>
          </> : <button type="button" disabled={loading} onClick={() => void load()}>{t("Retry")}</button>}
        </div>
      </AnimatedCollapse>
      <div className="desktop-bots-memory-actions">
        <button type="button" disabled={!dirty || draft.busy || draft.conflict} onClick={() => void mutate()}>{t(draft.busy ? "Saving…" : "Save file")}</button>
        <span>{t("Revision {revision}", { revision: draft.base.revision })}</span>
      </div>
      <button className="desktop-bots-memory-history-toggle" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>{t("Change history")}</button>
      <AnimatedCollapse expanded={historyOpen}>
        <div className="desktop-bots-memory-history">
          {historyError && <p role="alert">{t(historyError)} <button type="button" onClick={() => void loadHistory()}>{t("Retry")}</button></p>}
          {history?.length === 0 && <p>{t("No file changes yet")}</p>}
          {history?.map((change) => <div key={change.id}>
            <span><time dateTime={new Date(change.at).toISOString()}>{new Date(change.at).toLocaleString()}</time><small>{t("Revision {revision}", { revision: change.revision })} · {t(({ user: "User", assistant: "Assistant", external: "External edit", migration: "Migration", undo: "Undo" })[change.source])}</small></span>
            <button type="button" disabled={dirty || draft.busy || draft.conflict} onClick={() => void mutate(change.id)}>{t("Undo")}</button>
          </div>)}
        </div>
      </AnimatedCollapse>
    </> : loading ? <p role="status">{t("Loading…")}</p> : <button type="button" onClick={() => void load()}>{t("Retry")}</button>}
  </section>;
}
