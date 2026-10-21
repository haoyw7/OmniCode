import { Textarea } from "../../../shared/ui/forms/Textarea";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { useIsFetching, useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { botPanelKey, botMemoryListQuery, botMemoryDocumentQuery, botMemoryHistoryQuery } from "../model/botPanelQueries";
import { Input } from "../../../shared/ui/forms/Input";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { SearchableSelect, type SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import { ChevronDown, Plus, RefreshCw } from "../../../shared/ui/icons";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotMemoryDocument, BotMemoryKind } from "../model/botMemory";
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
  const [actionError, setError] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newTopic, setNewTopic] = useState(false);
  const topicForm = useForm({
    resolver: zodResolver(z.object({ topic: z.string().trim().min(1, t("This field is required")) })),
    defaultValues: { topic: "" },
  });
  const topic = useWatch({ control: topicForm.control, name: "topic" });
  const path = state.path;
  const draft = state.drafts[path];
  const dirty = !!draft && draft.text !== draft.base.text;
  const applyDocument = useCallback((doc: BotMemoryDocument) => {
    const path = doc.path;
    drafts.draft(botId, path, (current) => {
      if (current?.busy) return current;
      if (current && current.base.revision > doc.revision) return current;
      if (current && current.text !== current.base.text) return current.base.hash === doc.hash && current.base.revision === doc.revision
        ? current : { ...current, latest: doc, conflict: true };
      return { base: doc, text: doc.text };
    });
    return doc;
  }, [botId, rpc, drafts]);
  const listQuery = useQuery({ ...botMemoryListQuery(rpc, botId), enabled: visible }, queryClient);
  const documentQuery = useQuery({ ...botMemoryDocumentQuery(rpc, botId, path), enabled: visible }, queryClient);
  const historyQuery = useQuery({ ...botMemoryHistoryQuery(rpc, botId, path), enabled: visible && historyOpen }, queryClient);
  const files = listQuery.data, history = historyQuery.data;
  const loading = useIsFetching({ queryKey: [...botPanelKey(rpc), "memory", botId, "document"] }, queryClient) > 0 || listQuery.isFetching;
  const error = actionError ?? (listQuery.error || documentQuery.error ? botErrorMessage(listQuery.error ?? documentQuery.error) : undefined);
  const historyError = historyQuery.error ? botErrorMessage(historyQuery.error) : undefined;
  useEffect(() => { if (documentQuery.data) applyDocument(documentQuery.data); }, [documentQuery.data, applyDocument]);
  const read = async (path: string) => applyDocument(await queryClient.fetchQuery(botMemoryDocumentQuery(rpc, botId, path)));
  const list = () => listQuery.refetch({ throwOnError: true });
  const loadHistory = () => historyQuery.refetch();
  const load = async () => { setError(undefined); await Promise.all([listQuery.refetch(), documentQuery.refetch()]); };
  const mutation = useMutation({
    mutationFn: ({ method, params }: { method: "botMemory.save" | "botMemory.undo"; params: object }) => rpc<BotMemoryDocument>(method, params),
    onMutate: () => queryClient.cancelQueries({ queryKey: botMemoryDocumentQuery(rpc, botId, path).queryKey }),
    onSuccess: doc => { queryClient.setQueryData(botMemoryDocumentQuery(rpc, botId, doc.path).queryKey, doc); },
  }, queryClient);
  const mutate = async (changeId?: string) => {
    const current = drafts.get(botId).drafts[path];
    if (!current || current.busy || current.conflict) return;
    if (changeId && (current.text !== current.base.text || !history?.some((change) => change.id === changeId && change.path === path))) return;
    const expected = { expectedRevision: current.base.revision, expectedHash: current.base.hash };
    const signature = JSON.stringify([changeId ?? "save", path, current.text, expected]);
    const command = current.command?.signature === signature ? current.command : { signature, id: crypto.randomUUID() };
    drafts.draft(botId, path, () => ({ ...current, command, busy: true, error: undefined }));
    try {
      const doc = await mutation.mutateAsync({ method: changeId ? "botMemory.undo" : "botMemory.save", params: {
        botId, commandId: command.id, ...expected, ...(changeId ? { changeId } : { path, text: current.text }),
      }});
      drafts.draft(botId, path, () => ({ base: doc, text: doc.text }));
      void list().catch(() => {});
      if (historyOpen) void loadHistory();
    } catch (cause) {
      const conflict = isConflict(cause);
      drafts.draft(botId, path, (value) => ({ ...value!, busy: false, conflict, error: conflict ? undefined : botErrorMessage(cause) }));
      if (conflict) {
        // Loading the competing version never replaces the local text.
        try {
          const latest = await queryClient.fetchQuery(botMemoryDocumentQuery(rpc, botId, path));
          drafts.draft(botId, path, (value) => ({ ...value!, latest }));
        } catch (error) { setError(botErrorMessage(error)); }
      }
    }
  };
  const openTopic = topicForm.handleSubmit(async ({ topic }) => {
    if (loading) return;
    const next = `memory/${topic.trim().replace(/\.md$/i, "")}.md`;
    setError(undefined);
    try {
      await read(next);
      drafts.update(botId, (value) => ({ ...value, path: next }));
      setNewTopic(false); topicForm.reset();
    } catch (cause) { setError(botErrorMessage(cause)); toast.error(t(botErrorMessage(cause))); }
  });
  const unsaved = (item: string) => !!state.drafts[item] && state.drafts[item].text !== state.drafts[item].base.text;
  const fileOption = (item: string, group?: string): SearchableSelectOption => ({
    value: item, label: item, group, trailing: unsaved(item) ? <small className="text-ui-xs text-content/50">{t("Unsaved changes")}</small> : undefined,
  });
  const fileOptions = [
    ...[...new Set([path, ...Object.keys(state.drafts)])].filter((item) => !files?.files.some((file) => file.path === item)).map((item) => fileOption(item)),
    ...kinds.flatMap(([kind, label]) => (files?.files.filter((file) => file.kind === kind) ?? []).map((file) => fileOption(file.path, t(label)))),
  ];
  return <section className="desktop-bots-memory" aria-label={t("Memory files")}>
    <div className="desktop-bots-memory-toolbar">
      <SearchableSelect label={t("Memory file")} value={path} options={fileOptions} codeLabels className="desktop-bots-memory-file"
        searchPlaceholder={t("Search options…")} emptyLabel={t("No matching options")}
        onChange={(next) => drafts.update(botId, (value) => ({ ...value, path: next }))} />
      <IconButton label={t("New topic")} active={newTopic} aria-expanded={newTopic} onClick={() => setNewTopic((value) => !value)}><Plus /></IconButton>
      <IconButton label={t("Refresh")} disabled={loading || draft?.busy} onClick={() => void load()}><RefreshCw /></IconButton>
    </div>
    <AnimatedCollapse expanded={newTopic}>
      <form className="desktop-bots-memory-new" noValidate onSubmit={openTopic}>
        <label>{t("Topic name")}<Input {...topicForm.register("topic")} aria-invalid={!!topicForm.formState.errors.topic} placeholder={t("Topic name")} /></label>
        <Button size="sm" variant="primary" type="submit" disabled={loading || topicForm.formState.isSubmitting || !topic.trim()}>{t("Open draft")}</Button>
        <FieldError errors={[topicForm.formState.errors.topic]} />
      </form>
    </AnimatedCollapse>
    {files?.topicsTruncated && <p role="status">{t("The topic index is limited to {count} files.", { count: files.topicLimit })}</p>}
    {error && <p className="desktop-bots-memory-error" role="alert">{t(error)}</p>}
    {draft ? <>
      {draft.base.budget && <div className="desktop-bot-row-group">
        <p className="desktop-bot-row desktop-bots-memory-budget" data-truncated={draft.base.budget.truncated} role="status">
          <span className="desktop-bot-row-title">{t(draft.base.budget.truncated ? "Memory is truncated in prompts" : "Memory fits the prompt budget")}
            <small>{t("{lines} / {maxLines} lines · {bytes} / {maxBytes} bytes loaded", { lines: draft.base.budget.loadedLines, maxLines: draft.base.budget.maxLines, bytes: draft.base.budget.loadedBytes, maxBytes: draft.base.budget.maxBytes })}</small>
            <small>{t("Full file: {lines} lines · {bytes} bytes", { lines: draft.base.budget.lines, bytes: draft.base.budget.bytes })}</small></span>
        </p>
      </div>}
      <label className="desktop-bots-memory-editor-label"><span><span data-file-label>{path}</span>{dirty ? ` • ${t("Unsaved changes")}` : ""}</span>
        <Textarea data-ui="textarea" aria-label={t("File contents")} value={draft.text} disabled={draft.busy} spellCheck={false}
          onChange={(event) => drafts.draft(botId, path, (value) => ({ ...value!, text: event.target.value, error: undefined }))} />
      </label>
      {draft.error && <p className="desktop-bots-memory-error" role="alert">{t(draft.error)}</p>}
      <AnimatedCollapse expanded={!!draft.conflict}>
        <div className="desktop-bots-memory-conflict" role="alert">
          <p>{t("This file changed elsewhere. Your draft is preserved.")}</p>
          {draft.latest ? <>
            <label>{t("Latest saved version")}<Textarea data-ui="textarea" readOnly aria-label={t("Latest saved version")} value={draft.latest.text} /></label>
            <div className="desktop-bots-memory-actions">
              <Button size="sm" variant="secondary" type="button" onClick={() => drafts.draft(botId, path, (value) => ({ base: value!.latest!, text: value!.latest!.text }))}>{t("Use latest version")}</Button>
              <Button size="sm" variant="secondary" type="button" onClick={() => drafts.draft(botId, path, (value) => ({ base: value!.latest!, text: value!.text }))}>{t("Keep draft over latest")}</Button>
            </div>
          </> : <Button size="sm" variant="secondary" type="button" disabled={loading} onClick={() => void load()}>{t("Retry")}</Button>}
        </div>
      </AnimatedCollapse>
      <div className="desktop-bots-memory-actions">
        <span className="desktop-bot-row-meta">{t("Revision {revision}", { revision: draft.base.revision })}</span>
        <Button size="sm" variant={dirty ? "primary" : "secondary"} type="button" disabled={!dirty || draft.busy || draft.conflict} onClick={() => void mutate()}>{t(draft.busy ? "Saving…" : "Save file")}</Button>
      </div>
      <div className="desktop-bot-row-group"><section className="assistant-settings-section" data-open={historyOpen}>
        <Button variant="ghost" size="content" type="button" className="assistant-settings-disclosure" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>
          <span className="assistant-settings-disclosure-title">{t("Change history")}</span><ChevronDown aria-hidden="true" />
        </Button>
        <AnimatedCollapse expanded={historyOpen}><div className="desktop-bots-memory-history">
            {historyError && <p role="alert">{t(historyError)} <Button size="sm" variant="secondary" type="button" onClick={() => void loadHistory()}>{t("Retry")}</Button></p>}
            {history?.length === 0 && <p>{t("No file changes yet")}</p>}
            {history?.map((change) => <div key={change.id} className="desktop-bot-row">
              <span className="desktop-bot-row-title"><time dateTime={new Date(change.at).toISOString()}>{new Date(change.at).toLocaleString()}</time><small>{t("Revision {revision}", { revision: change.revision })} · {t(({ user: "User", assistant: "Assistant", external: "External edit", migration: "Migration", undo: "Undo" })[change.source])}</small></span>
              <Button size="sm" variant="ghost" type="button" disabled={dirty || draft.busy || draft.conflict} onClick={() => void mutate(change.id)}>{t("Undo")}</Button>
            </div>)}
        </div></AnimatedCollapse>
      </section></div>
    </> : loading ? <p role="status">{t("Loading…")}</p> : <Button size="sm" variant="secondary" type="button" onClick={() => void load()}>{t("Retry")}</Button>}
  </section>;
}
