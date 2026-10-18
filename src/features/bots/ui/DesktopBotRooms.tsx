import { useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotView } from "../model/bots";
import type { BotRoom } from "../model/botRooms";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { DesktopBotMembers } from "./DesktopBotMembers";
import "./desktop-bot-collaboration.css";

type Props = { rooms: BotRoom[]; bots: BotView[]; rpc: BotRpc; onSaved: () => Promise<unknown>; onOpenRoom: (id: string) => void };
export function DesktopBotRooms({ rooms, bots, rpc, onSaved, onOpenRoom }: Props) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [selected, setSelected] = useState<string>(), [visited, setVisited] = useState<string[]>([]), [version, setVersion] = useState(0);
  const open = (id: string) => { setSelected(id); setVisited(current => current.includes(id) ? current : [...current, id]); };
  const saved = async (room: BotRoom) => { await onSaved(); if (selected === "new") setVersion(value => value + 1); open(room.id); };
  return <section className="desktop-bot-directory" aria-label={t("Rooms")}>
    <header><h2>{t("Rooms")}</h2><button type="button" onClick={() => open("new")}>{t("New room")}</button></header>
    <div className="desktop-bot-directory-body"><div className="desktop-bot-directory-list">
      {rooms.map(room => <button type="button" key={room.id} aria-pressed={selected === room.id} onClick={() => open(room.id)}><strong>{room.name}</strong><small>{room.archivedAt ? t("Archived") : `${room.memberIds.length} ${t("Members")}`}</small></button>)}{!rooms.length && <p>{t("No rooms yet")}</p>}
    </div><div className="desktop-bot-directory-editors">{visited.map(id => {
      const room = rooms.find(room => room.id === id), active = selected === id;
      if (id !== "new" && !room) return null;
      return <div key={id === "new" ? `new:${version}` : id} hidden={!active} inert={!active}><SurfaceVisibilityContext.Provider value={visible && active}>
        {room && <button className="desktop-bot-open-room" type="button" onClick={() => onOpenRoom(room.id)}>{t("Open room")}</button>}
        <DesktopRoomEditor room={room} bots={bots} rpc={rpc} onSaved={saved} />
      </SurfaceVisibilityContext.Provider></div>;
    })}{!selected && <p>{t("Select a room or create one")}</p>}</div></div>
  </section>;
}

export function DesktopRoomEditor({ room, bots, rpc, onSaved }: { room?: BotRoom; bots: BotView[]; rpc: BotRpc; onSaved: (room: BotRoom) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [base, setBase] = useState(room), [name, setName] = useState(room?.name ?? ""), [members, setMembers] = useState(room?.memberIds ?? []), [timeout, setMemberTimeout] = useState(String((room?.memberTimeoutMs ?? 240000) / 1000));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = name !== (base?.name ?? "") || JSON.stringify(members) !== JSON.stringify(base?.memberIds ?? []) || Number(timeout) * 1000 !== (base?.memberTimeoutMs ?? 240000);
  const valid = !!name.trim() && members.length >= 1 && members.length <= 10 && Number(timeout) >= .001 && Number(timeout) <= 240;
  const adopt = (next?: BotRoom) => { setBase(next); setName(next?.name ?? ""); setMembers(next?.memberIds ?? []); setMemberTimeout(String((next?.memberTimeoutMs ?? 240000) / 1000)); };
  useEffect(() => { if (!busy && !dirty && !command.current && room && (!base || room.revision > base.revision)) adopt(room); }, [room, busy, dirty]);
  const mutate = async (action: "save" | "archive" | "restore") => {
    if (busy || (action === "save" && !valid)) return;
    const patch = { name: name.trim(), memberIds: members, memberTimeoutMs: Math.round(Number(timeout) * 1000) };
    const method = action === "save" ? base ? "botRooms.configure" : "botRooms.create" : `botRooms.${action}`;
    const params = base ? { roomId: base.id, expectedRevision: base.revision, ...(action === "save" ? { patch } : {}) } : patch;
    const signature = JSON.stringify([method, params]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try { const result = await rpc<BotRoom>(method, { ...params, commandId: command.current.id }); await onSaved(result); adopt(result); command.current = undefined; }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    if (!base || busy) return;
    setBusy(true);
    try { const next = await rpc<{ room: BotRoom }>("botRooms.get", { roomId: base.id }); adopt(next.room); command.current = undefined; setError(undefined); }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <form className="desktop-bot-group-editor" aria-label={t(base ? "Room settings" : "New room")} onSubmit={event => { event.preventDefault(); void mutate("save"); }}>
    <h3>{t(base ? "Room settings" : "New room")}</h3>
    <fieldset disabled={busy || !!room?.archivedAt}>
      <label>{t("Room name")}<input data-ui="input" aria-label={t("Room name")} value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
      <DesktopBotMembers bots={bots} ids={members} ordered onChange={setMembers} />
      <small>{t("Choose 1–10 members. Each speaks once in the listed order.")}</small>
      <label>{t("Member timeout (seconds)")}<input data-ui="input" type="number" min={.001} max={240} step="any" value={timeout} onChange={event => setMemberTimeout(event.target.value)} /></label>
    </fieldset>
    {error && <p role="alert">{t(error)}</p>}
    <footer><button type="submit" disabled={busy || !!room?.archivedAt || !valid || (!!base && !dirty)}>{t(base ? "Save room" : "Create room")}</button>
      {base && <><button type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</button><button type="button" disabled={busy} onClick={() => void mutate(room?.archivedAt ? "restore" : "archive")}>{t(room?.archivedAt ? "Restore room" : "Archive room")}</button></>}
    </footer>
  </form>;
}
