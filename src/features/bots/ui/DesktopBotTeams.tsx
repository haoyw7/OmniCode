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
    <header><h2>{t("Teams")}</h2><button type="button" onClick={() => open("new")}>{t("New team")}</button></header>
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
  const [base, setBase] = useState(team), [name, setName] = useState(team?.name ?? ""), [members, setMembers] = useState(team?.memberBotIds ?? []), [chief, setChief] = useState(team?.chiefBotId ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = name !== (base?.name ?? "") || JSON.stringify(members) !== JSON.stringify(base?.memberBotIds ?? []) || chief !== (base?.chiefBotId ?? "");
  const adopt = (next?: BotTeam) => { setBase(next); setName(next?.name ?? ""); setMembers(next?.memberBotIds ?? []); setChief(next?.chiefBotId ?? ""); };
  useEffect(() => { if (!busy && !dirty && !command.current && team && (!base || team.revision > base.revision)) adopt(team); }, [team, busy, dirty]);
  const mutate = async (action: "save" | "archive" | "restore") => {
    if (busy || (action === "save" && !name.trim())) return;
    const method = action === "save" ? base ? "botTeams.configure" : "botTeams.create" : `botTeams.${action}`;
    const params = { ...(base ? { teamId: base.id, expectedRevision: base.revision } : {}), ...(action === "save" ? { patch: { name: name.trim(), memberBotIds: members, chiefBotId: chief || null } } : {}) };
    const signature = JSON.stringify([method, params]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try { const result = await rpc<BotTeam>(method, { ...params, commandId: command.current.id }); await onSaved(result); adopt(result); command.current = undefined; }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    if (!base || busy) return;
    setBusy(true);
    try { adopt(await rpc<BotTeam>("botTeams.get", { teamId: base.id })); command.current = undefined; setError(undefined); }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <form className="desktop-bot-group-editor" aria-label={t(base ? "Team settings" : "New team")} onSubmit={event => { event.preventDefault(); void mutate("save"); }}>
    <h3>{t(base ? "Team settings" : "New team")}</h3>
    <fieldset disabled={busy || !!team?.archivedAt}>
      <label>{t("Team name")}<input data-ui="input" aria-label={t("Team name")} value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
      <DesktopBotMembers bots={bots} ids={members} onChange={ids => { setMembers(ids); if (!ids.includes(chief)) setChief(""); }} />
      <label>{t("Chief of Staff")}<select data-ui="select" aria-label={t("Chief of Staff")} value={chief} onChange={event => setChief(event.target.value)}><option value="">{t("No Chief")}</option>{members.map(id => <option key={id} value={id}>{bots.find(bot => bot.id === id)?.name ?? t("Unavailable Bot")}</option>)}</select></label>
      <small>{t("Each team has at most one Chief. Its calls still follow each Bot's permissions.")}</small>
    </fieldset>
    {error && <p role="alert">{t(error)}</p>}
    <footer><button type="submit" disabled={busy || !!team?.archivedAt || !name.trim() || (!!base && !dirty)}>{t(base ? "Save team" : "Create team")}</button>
      {base && <><button type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</button><button type="button" disabled={busy} onClick={() => void mutate(team?.archivedAt ? "restore" : "archive")}>{t(team?.archivedAt ? "Restore team" : "Archive team")}</button></>}
    </footer>
  </form>;
}
