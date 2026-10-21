import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { Input } from "../../../shared/ui/forms/Input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { botRpcQuery } from "../model/botPanelQueries";
import { Button } from "../../../shared/ui/forms/Button";
import { useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotView } from "../model/bots";
import type { BotTeam } from "../model/botTeams";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { DesktopBotMembers } from "./DesktopBotMembers";
import "./desktop-bot-collaboration.css";

type Props = { teams: BotTeam[]; bots: BotView[]; rpc: BotRpc; onSaved: () => Promise<unknown> };
export function DesktopBotTeams({ teams, bots, rpc, onSaved }: Props) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [selected, setSelected] = useState<string>(), [visited, setVisited] = useState<string[]>([]), [version, setVersion] = useState(0);
  const open = (id: string) => { setSelected(id); setVisited(current => current.includes(id) ? current : [...current, id]); };
  const saved = async (team: BotTeam) => { await onSaved(); if (selected === "new") setVersion(value => value + 1); open(team.id); };
  return <section className="desktop-bot-directory" aria-label={t("Teams")}>
    <header><h2>{t("Teams")}</h2><Button variant="secondary" type="button" onClick={() => open("new")}>{t("New team")}</Button></header>
    <div className="desktop-bot-directory-body">
      <div className="desktop-bot-directory-list">{teams.map(team => <button type="button" key={team.id} aria-pressed={selected === team.id} onClick={() => open(team.id)}><strong>{team.name}</strong><small>{team.archivedAt ? t("Archived") : `${team.memberBotIds.length} ${t("Members")}`}</small></button>)}{!teams.length && <p>{t("No teams yet")}</p>}</div>
      <div className="desktop-bot-directory-editors">{visited.map(id => {
        const value = teams.find(team => team.id === id), active = selected === id;
        if (id !== "new" && !value) return null;
        return <div key={id === "new" ? `new:${version}` : id} hidden={!active} inert={!active}><SurfaceVisibilityContext.Provider value={visible && active}>
          <TeamEditor team={value} bots={bots} rpc={rpc} onSaved={saved} />
        </SurfaceVisibilityContext.Provider></div>;
      })}{!selected && <p>{t("Select a team or create one")}</p>}</div>
    </div>
  </section>;
}
function TeamEditor({ team, bots, rpc, onSaved }: { team?: BotTeam; bots: BotView[]; rpc: BotRpc; onSaved: (team: BotTeam) => Promise<void> }) {
  const { t } = useTranslation();
  const [base, setBase] = useState(team);
  const form = useForm({
    resolver: zodResolver(z.object({
      name: z.string().trim().min(1, t("Enter a name")).max(100, t("Use at most {count} characters", { count: 100 })),
      members: z.array(z.string()), chief: z.string(),
    }).refine(values => !values.chief || values.members.includes(values.chief), { path: ["chief"], message: t("Choose a team member") })),
    defaultValues: { name: team?.name ?? "", members: team?.memberBotIds ?? [], chief: team?.chiefBotId ?? "" },
  });
  const [name, members, chief] = useWatch({ control: form.control, name: ["name", "members", "chief"] });
  const setMembers = (value: string[]) => form.setValue("members", value, { shouldDirty: true, shouldValidate: true });
  const setChief = (value: string) => form.setValue("chief", value, { shouldDirty: true, shouldValidate: true });
  const savedRead = useQuery({ ...botRpcQuery<BotTeam>(rpc, "botTeams.get", { teamId: base?.id }), enabled: false }, queryClient);
  const actionMutation = useMutation({ mutationFn: (action: () => Promise<void>) => withToast(action,
    { loading: t("Saving…"), success: false, error: cause => t(botErrorMessage(cause)) }) }, queryClient);
  const busy = actionMutation.isPending || savedRead.isFetching;
  const cause = actionMutation.error ?? savedRead.error;
  const error = cause ? botErrorMessage(cause) : undefined;
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = name !== (base?.name ?? "") || JSON.stringify(members) !== JSON.stringify(base?.memberBotIds ?? []) || chief !== (base?.chiefBotId ?? "");
  const adopt = (next?: BotTeam) => { setBase(next); form.reset({ name: next?.name ?? "", members: next?.memberBotIds ?? [], chief: next?.chiefBotId ?? "" }); };
  useEffect(() => { if (!busy && !dirty && !command.current && team && (!base || team.revision > base.revision)) adopt(team); }, [team, busy, dirty]);
  const mutate = async (action: "save" | "archive" | "restore") => {
    if (busy || (action === "save" && !name.trim())) return;
    const method = action === "save" ? base ? "botTeams.configure" : "botTeams.create" : `botTeams.${action}`;
    const params = { ...(base ? { teamId: base.id, expectedRevision: base.revision } : {}), ...(action === "save" ? { patch: { name: name.trim(), memberBotIds: members, chiefBotId: chief || null } } : {}) };
    const signature = JSON.stringify([method, params]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    const commandId = command.current.id;
    actionMutation.mutate(async () => {
      const result = await rpc<BotTeam>(method, { ...params, commandId }); await onSaved(result); adopt(result); command.current = undefined;
    });
  };
  const reload = async () => {
    if (!base || busy) return;
    actionMutation.reset();
    const next = await savedRead.refetch(); if (!next.isSuccess) return; adopt(next.data); command.current = undefined;
  };
  return <form className="desktop-bot-group-editor" aria-label={t(base ? "Team settings" : "New team")} noValidate onSubmit={form.handleSubmit(() => { if (!team?.archivedAt) void mutate("save"); })}>
    <h3>{t(base ? "Team settings" : "New team")}</h3>
    <fieldset disabled={busy || !!team?.archivedAt}>
      <label>{t("Team name")}<Input aria-label={t("Team name")} {...form.register("name")} aria-invalid={!!form.formState.errors.name} maxLength={100} /></label>
      <DesktopBotMembers bots={bots} ids={members} onChange={ids => { setMembers(ids); if (!ids.includes(chief)) setChief(""); }} />
      <label>{t("Chief of Staff")}<select data-ui="select" aria-label={t("Chief of Staff")} value={chief} aria-invalid={!!form.formState.errors.chief} onChange={event => setChief(event.target.value)}><option value="">{t("No Chief")}</option>{members.map(id => <option key={id} value={id}>{bots.find(bot => bot.id === id)?.name ?? t("Unavailable Bot")}</option>)}</select></label>
      <small>{t("Each team has at most one Chief. Its calls still follow each Bot's permissions.")}</small>
    </fieldset>
    <FieldError errors={[form.formState.errors.name, form.formState.errors.chief]} />
    {error && <p role="alert">{t(error)}</p>}
    <footer><Button variant="primary" type="submit" disabled={busy || !!team?.archivedAt || !name.trim() || (!!base && !dirty)}>{t(base ? "Save team" : "Create team")}</Button>
      {base && <><Button variant="secondary" type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</Button><Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate(team?.archivedAt ? "restore" : "archive")}>{t(team?.archivedAt ? "Restore team" : "Archive team")}</Button></>}
    </footer>
  </form>;
}
