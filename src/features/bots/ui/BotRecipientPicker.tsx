import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import { Textarea } from "../../../shared/ui/forms/Textarea";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { useEffect, useId, useRef, useState } from "react";
import type { BotView } from "../model/bots";
import { BotAvatar } from "./BotAvatar";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ArrowUp, Plus, X } from "../../../shared/ui/icons";
import { botErrorMessage } from "../model/botErrors";

export function BotRecipientPicker({ open, bots, roomsSupported, onChoose, onCreate, onClose, onSend }: {
  open: boolean; bots: BotView[]; roomsSupported: boolean; onChoose: (bot: BotView) => void;
  onCreate: () => void; onClose: () => void; onSend: (bots: BotView[], text: string) => Promise<void>;
}) {
  const { t } = useTranslation(), visible = useSurfaceVisibility(), id = useId();
  const [query, setQuery] = useState(""), [highlight, setHighlight] = useState(0), [dropdown, setDropdown] = useState(true);
  const form = useForm({
    resolver: zodResolver(z.object({
      draft: z.string().refine(value => !!value.trim(), t("This field is required")),
      members: z.array(z.string()).min(2, t("Add another Bot to start a room")).max(10),
    })),
    defaultValues: { draft: "", members: [] as string[] },
  });
  const [draft, members] = useWatch({ control: form.control, name: ["draft", "members"] });
  const setMembers = (next: string[] | ((current: string[]) => string[])) => form.setValue("members", typeof next === "function" ? next(form.getValues("members")) : next);
  const mutation = useMutation({ mutationFn: ({ bots, text }: { bots: BotView[]; text: string }) => withToast(() => onSend(bots, text),
    { loading: t("Sending..."), success: false, error: cause => t(botErrorMessage(cause)) }),
    onSuccess: () => { form.reset(); setQuery(""); },
  }, queryClient);
  const busy = mutation.isPending, error = mutation.error ? botErrorMessage(mutation.error) : undefined;
  const input = useRef<HTMLInputElement>(null);
  const active = open && visible;
  const selected = roomsSupported ? members.flatMap(id => { const bot = bots.find(bot => bot.id === id && !bot.archivedAt); return bot ? [bot] : []; }) : [];
  const matches = bots.filter(bot => !bot.archivedAt && !selected.some(member => member.id === bot.id) && bot.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const index = Math.min(highlight, matches.length);
  const highlighted = index === 0 ? undefined : matches[index - 1];
  const expanded = active && dropdown;
  useEffect(() => { if (active) { setDropdown(true); input.current?.focus(); } }, [active]);
  useEffect(() => { if (expanded) document.getElementById(`${id}-option-${index}`)?.scrollIntoView?.({ block: "nearest" }); }, [expanded, id, index]);
  const choose = (bot?: BotView) => { if (busy) return; if (bot) onChoose(bot); else onCreate(); };
  const add = (bot: BotView) => {
    if (busy || !roomsSupported || selected.length >= 10) return;
    setMembers(current => [...current.filter(id => id !== bot.id), bot.id]); setQuery(""); setHighlight(0); input.current?.focus();
  };
  const send = form.handleSubmit(({ draft }) => {
    if (busy || !active || selected.length < 2 || !roomsSupported || !draft.trim()) return;
    mutation.mutate({ bots: selected, text: draft });
  });
  return <section className="desktop-bot-recipient" aria-label={t("New conversation")} inert={!active} aria-hidden={!active || undefined} onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); setDropdown(false); onClose(); }
  }}>
    <header className="desktop-bot-recipient-header">
      <label htmlFor={id}>{t("To:")}</label>
      <div className="desktop-bot-recipients">
        {selected.map(bot => <span key={bot.id} className="desktop-bot-recipient-chip"><BotAvatar bot={bot} size={24} />{bot.name}<Button variant="ghost" size="content" type="button" disabled={busy} aria-label={t("Remove {name}", { name: bot.name })} onClick={() => setMembers(current => current.filter(id => id !== bot.id))}><X /></Button></span>)}
        <Input variant="inline" ref={input} id={id} role="combobox" value={query} disabled={busy} autoComplete="off" aria-label={t("Search or create a Bot")} placeholder={t("Search or create a Bot")}
          aria-expanded={expanded} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={expanded ? `${id}-option-${index}` : undefined}
          onFocus={() => setDropdown(true)} onChange={event => { setQuery(event.target.value); setHighlight(0); setDropdown(true); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || busy) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setDropdown(true); setHighlight((index + (event.key === "ArrowDown" ? 1 : matches.length)) % (matches.length + 1)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(highlighted); }
            else if (event.key === "Tab" && !event.shiftKey && roomsSupported && highlighted && selected.length < 10) { event.preventDefault(); add(highlighted); }
          }} />
      </div>
      <IconButton type="button" className="assistant-icon-button" disabled={busy} label={t("Cancel")} onClick={onClose}><X /></IconButton>
    </header>
    <AnimatedCollapse expanded={expanded} className="desktop-bot-recipient-dropdown">
      <div className="desktop-bot-recipient-menu">
        <div role="listbox" id={`${id}-list`} aria-label={t("Recipients")}>
          <Button data-menu-row="single" variant="ghost" size="content" type="button" role="option" id={`${id}-option-0`} aria-selected={index === 0} tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose()}><span className="desktop-bot-recipient-create"><Plus /></span><span>{t("Create new Bot")}</span></Button>
          {matches.map((bot, i) => <Button data-menu-row="single" variant="ghost" size="content" type="button" role="option" id={`${id}-option-${i + 1}`} aria-selected={index === i + 1} tabIndex={-1} key={bot.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlight(i + 1)} onClick={() => choose(bot)}><BotAvatar bot={bot} size={16} /><span>{bot.name}</span></Button>)}
        </div>
        <footer>{roomsSupported && <span>{t("Tab to add")}</span>}<span>{t("Enter to open")}</span></footer>
      </div>
    </AnimatedCollapse>
    <div className="desktop-bot-recipient-space" onClick={() => setDropdown(false)} />
    {error && <p role="alert" className="desktop-bot-recipient-error">{t(error)}</p>}
    {roomsSupported && <AnimatedCollapse expanded={selected.length > 0} className="desktop-bot-recipient-compose">
      <form noValidate onSubmit={send}>
        <label className="desktop-bot-recipient-hint">{t(selected.length < 2 ? "Add another Bot to start a room" : "Send a message to start a room")}</label>
        <div><Textarea variant="editor" rows={1} {...form.register("draft")} aria-invalid={!!form.formState.errors.draft} disabled={busy} aria-label={t("Room message")} placeholder={t("Message your Bots…")} onFocus={() => setDropdown(false)} onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} /><IconButton shape="round" type="submit" className="assistant-send" label={t("Send")} disabled={busy || selected.length < 2 || !draft.trim()}><ArrowUp /></IconButton></div>
        <FieldError errors={[form.formState.errors.draft, form.formState.errors.members]} />
      </form>
    </AnimatedCollapse>}
  </section>;
}
