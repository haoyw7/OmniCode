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
    <header><h2>{t("Rooms")}</h2><Button variant="secondary" type="button" onClick={() => open("new")}>{t("New room")}</Button></header>
    <div className="desktop-bot-directory-body"><div className="desktop-bot-directory-list">
      {rooms.map(room => <Button variant="ghost" size="content" type="button" key={room.id} aria-pressed={selected === room.id} onClick={() => open(room.id)}><strong>{room.name}</strong><small>{room.archivedAt ? t("Archived") : `${room.memberIds.length} ${t("Members")}`}</small></Button>)}{!rooms.length && <p>{t("No rooms yet")}</p>}
    </div><div className="desktop-bot-directory-editors">{visited.map(id => {
      const room = rooms.find(room => room.id === id), active = selected === id;
      if (id !== "new" && !room) return null;
      return <div key={id === "new" ? `new:${version}` : id} hidden={!active} inert={!active}><SurfaceVisibilityContext.Provider value={visible && active}>
        {room && <Button variant="secondary" className="desktop-bot-open-room" type="button" onClick={() => onOpenRoom(room.id)}>{t("Open room")}</Button>}
        <DesktopRoomEditor room={room} bots={bots} rpc={rpc} onSaved={saved} />
      </SurfaceVisibilityContext.Provider></div>;
    })}{!selected && <p>{t("Select a room or create one")}</p>}</div></div>
  </section>;
}

export function DesktopRoomEditor({ room, bots, rpc, onSaved }: { room?: BotRoom; bots: BotView[]; rpc: BotRpc; onSaved: (room: BotRoom) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [base, setBase] = useState(room);
  const schema = z.object({
    name: z.string().trim().min(1, t("Enter a name")).max(100, t("Use at most {count} characters", { count: 100 })),
    members: z.array(z.string()).min(1, t("Choose 1–10 members. Each speaks once in the listed order.")).max(10, t("Choose 1–10 members. Each speaks once in the listed order.")),
    timeout: z.string().refine(value => Number(value) >= .001 && Number(value) <= 240, t("Enter a timeout between 0.001 and 240 seconds")),
  });
  const form = useForm({
    resolver: zodResolver(schema), mode: "onChange",
    defaultValues: { name: room?.name ?? "", members: room?.memberIds ?? [], timeout: String((room?.memberTimeoutMs ?? 240000) / 1000) },
  });
  const [name, members, timeout] = useWatch({ control: form.control, name: ["name", "members", "timeout"] });
  const setMembers = (value: string[]) => form.setValue("members", value, { shouldDirty: true, shouldValidate: true });
  const savedRead = useQuery({ ...botRpcQuery<{ room: BotRoom }>(rpc, "botRooms.get", { roomId: base?.id }), enabled: false }, queryClient);
  const actionMutation = useMutation({ mutationFn: (action: () => Promise<void>) => withToast(action,
    { loading: t("Saving…"), success: false, error: cause => t(botErrorMessage(cause)) }) }, queryClient);
  const busy = actionMutation.isPending || savedRead.isFetching;
  const cause = actionMutation.error ?? savedRead.error;
  const error = cause ? botErrorMessage(cause) : undefined;
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = name !== (base?.name ?? "") || JSON.stringify(members) !== JSON.stringify(base?.memberIds ?? []) || Number(timeout) * 1000 !== (base?.memberTimeoutMs ?? 240000);
  const valid = schema.safeParse({ name, members, timeout }).success;
  const adopt = (next?: BotRoom) => { setBase(next); form.reset({ name: next?.name ?? "", members: next?.memberIds ?? [], timeout: String((next?.memberTimeoutMs ?? 240000) / 1000) }); };
  useEffect(() => { if (!busy && !dirty && !command.current && room && (!base || room.revision > base.revision)) adopt(room); }, [room, busy, dirty]);
  const mutate = async (action: "save" | "archive" | "restore") => {
    if (busy || (action === "save" && !valid)) return;
    const patch = { name: name.trim(), memberIds: members, memberTimeoutMs: Math.round(Number(timeout) * 1000) };
    const method = action === "save" ? base ? "botRooms.configure" : "botRooms.create" : `botRooms.${action}`;
    const params = base ? { roomId: base.id, expectedRevision: base.revision, ...(action === "save" ? { patch } : {}) } : patch;
    const signature = JSON.stringify([method, params]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    const commandId = command.current.id;
    actionMutation.mutate(async () => {
      const result = await rpc<BotRoom>(method, { ...params, commandId }); await onSaved(result); adopt(result); command.current = undefined;
    });
  };
  const reload = async () => {
    if (!base || busy) return;
    actionMutation.reset();
    const next = await savedRead.refetch(); if (!next.isSuccess) return; adopt(next.data.room); command.current = undefined;
  };
  return <form className="desktop-bot-group-editor" aria-label={t(base ? "Room settings" : "New room")} noValidate onSubmit={form.handleSubmit(() => { if (!room?.archivedAt) void mutate("save"); })}>
    <h3>{t(base ? "Room settings" : "New room")}</h3>
    <fieldset disabled={busy || !!room?.archivedAt}>
      <label>{t("Room name")}<Input aria-label={t("Room name")} {...form.register("name")} aria-invalid={!!form.formState.errors.name} maxLength={100} /></label>
      <DesktopBotMembers bots={bots} ids={members} ordered onChange={setMembers} />
      <small>{t("Choose 1–10 members. Each speaks once in the listed order.")}</small>
      <label>{t("Member timeout (seconds)")}<Input type="number" min={.001} max={240} step="any" {...form.register("timeout")} aria-invalid={!!form.formState.errors.timeout} /></label>
    </fieldset>
    <FieldError errors={[form.formState.errors.name, form.formState.errors.members, form.formState.errors.timeout]} />
    {error && <p role="alert">{t(error)}</p>}
    <footer><Button variant="primary" type="submit" disabled={busy || !!room?.archivedAt || !valid || (!!base && !dirty)}>{t(base ? "Save room" : "Create room")}</Button>
      {base && <><Button variant="secondary" type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</Button><Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate(room?.archivedAt ? "restore" : "archive")}>{t(room?.archivedAt ? "Restore room" : "Archive room")}</Button></>}
    </footer>
  </form>;
}
