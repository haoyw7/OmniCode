import { Textarea } from "../../../shared/ui/forms/Textarea";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { BotConfiguration, BotPatch } from "../model/botView";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { Pencil } from "../../../shared/ui/icons";
import { BotAvatar } from "./BotAvatar";
import { BotAvatarPicker } from "./BotAvatarPicker";
import { botAvatarAppearance, decodeBotAvatar, encodeBotAvatar } from "./botAvatarAppearance";

export function BotIdentitySettings({ bot, busy, onSave, children, avatarSupported = false }: {
  bot: BotConfiguration; busy: boolean; onSave: (patch: BotPatch) => Promise<void>; children?: ReactNode; avatarSupported?: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(bot.name), [avatar, setAvatar] = useState(bot.avatar ?? "");
  const visible = useSurfaceVisibility();
  const [editingAvatar, setEditingAvatar] = useState(false), [avatarDraft, setAvatarDraft] = useState(avatar);
  const editor = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  const [avatarTab, setAvatarTab] = useState("bot"), [avatarPrompt, setAvatarPrompt] = useState("");
  const promptField = useRef<HTMLTextAreaElement>(null);
  const avatarTabs = [{ id: "bot", label: "Bot" }, { id: "generate", label: "Generate" }, { id: "upload", label: "Upload" }];
  const closeEditor = (restoreFocus = true) => { setEditingAvatar(false); if (restoreFocus) trigger.current?.focus(); };
  useEffect(() => { if (!visible) setEditingAvatar(false); }, [visible]);
  useEffect(() => {
    if (!editingAvatar) return;
    const outside = (event: PointerEvent) => { if (!editor.current?.contains(event.target as Node)) setEditingAvatar(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editingAvatar]);
  const applyAvatar = () => { if (!busy && [...avatarDraft].length <= 8) { setAvatar(avatarDraft); closeEditor(); } };
  const changed = name.trim() !== bot.name || (avatarSupported && avatar !== (bot.avatar ?? ""));
  return <form className="desktop-bot-identity" onSubmit={event => {
    event.preventDefault();
    if (changed && name.trim() && [...avatar].length <= 8 && !busy) void onSave({ name: name.trim(), ...(avatarSupported ? { avatar } : {}) });
  }}>
    {avatarSupported ? <div ref={editor} className="desktop-bot-avatar-editor" onKeyDown={event => {
      if (editingAvatar && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeEditor(); }
    }}>
      <button ref={trigger} type="button" className="desktop-bot-avatar-trigger" aria-label={t("Edit avatar")} aria-expanded={editingAvatar} aria-controls={editorId} disabled={busy}
        onClick={() => { setAvatarDraft(avatar); setEditingAvatar(value => !value); }}>
        <BotAvatar bot={{ id: bot.id, avatar: editingAvatar ? avatarDraft : avatar }} size={96} />
        <span className="desktop-bot-avatar-edit-overlay" aria-hidden="true"><Pencil size={20} /></span>
        <span className="desktop-bot-avatar-edit-hint" aria-hidden="true">{t("Edit avatar")}</span>
      </button>
      <AnimatedCollapse expanded={editingAvatar && visible} className="desktop-bot-avatar-popover" onEntered={() => (avatarTab === "generate" ? promptField.current : editor.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked'))?.focus()}>
        <div id={editorId} role="group" aria-label={t("Edit avatar")} className="desktop-bot-avatar-fields">
          <div className="desktop-bot-avatar-tabs" role="tablist" aria-label={t("Edit avatar")} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = avatarTabs.findIndex(tab => tab.id === avatarTab);
            const next = event.key === "Home" ? 0 : event.key === "End" ? avatarTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : avatarTabs.length - 1)) % avatarTabs.length;
            setAvatarTab(avatarTabs[next].id);
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>
            {avatarTabs.map(tab => <button key={tab.id} id={`${editorId}-${tab.id}-tab`} type="button" role="tab" aria-selected={avatarTab === tab.id} aria-controls={`${editorId}-${tab.id}-panel`} tabIndex={avatarTab === tab.id ? 0 : -1} onClick={() => setAvatarTab(tab.id)}>{t(tab.label)}</button>)}
          </div>
          <div id={`${editorId}-bot-panel`} role="tabpanel" aria-labelledby={`${editorId}-bot-tab`} hidden={avatarTab !== "bot"} className="desktop-bot-avatar-tab-panel">
          <BotAvatarPicker value={decodeBotAvatar(avatarDraft) ?? botAvatarAppearance(bot.id)} disabled={busy} onChange={value => setAvatarDraft(encodeBotAvatar(value))} />
          <div className="desktop-bot-avatar-actions">
            <Button variant="secondary" type="button" disabled={busy} onClick={() => setAvatarDraft("")}>{t("Reset")}</Button>
            <Button variant="secondary" type="button" onClick={() => closeEditor()}>{t("Cancel")}</Button>
            <Button variant="secondary" type="button" disabled={busy || [...avatarDraft].length > 8} onClick={applyAvatar}>{t("Apply")}</Button>
          </div>
          </div>
          <div id={`${editorId}-generate-panel`} role="tabpanel" aria-labelledby={`${editorId}-generate-tab`} hidden={avatarTab !== "generate"} className="desktop-bot-avatar-tab-panel">
            <Textarea ref={promptField} value={avatarPrompt} onChange={event => setAvatarPrompt(event.target.value)} placeholder={t("Describe your avatar…")} aria-label={t("Describe your avatar…")} disabled={busy} />
            <Button variant="secondary" type="button" className="desktop-bot-avatar-generate" disabled aria-describedby={`${editorId}-generation-unavailable`}>{t("Generate")}</Button>
            <small id={`${editorId}-generation-unavailable`}>{t("Avatar image generation is not available yet.")}</small>
          </div>
          <div id={`${editorId}-upload-panel`} role="tabpanel" aria-labelledby={`${editorId}-upload-tab`} hidden={avatarTab !== "upload"} className="desktop-bot-avatar-tab-panel" tabIndex={0}>
            <small>{t("Avatar image uploads are not available yet.")}</small>
          </div>
        </div>
      </AnimatedCollapse>
    </div> : <BotAvatar bot={{ id: bot.id, avatar }} size={96} />}
    <label>{t("Name")}<Input value={name} maxLength={100} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
    <Button variant="primary" type="submit" disabled={busy || !changed || !name.trim() || [...avatar].length > 8}>{t("Save")}</Button>
    {children}
  </form>;
}
