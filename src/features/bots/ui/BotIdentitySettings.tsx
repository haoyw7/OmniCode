import { Textarea } from "../../../shared/ui/forms/Textarea";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import { useEffect, useId, useRef, useState } from "react";
import type { BotConfiguration, BotPatch } from "../model/botView";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { Modal } from "../../../shared/ui/Modal";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { Pencil } from "../../../shared/ui/icons";
import { BotAvatar } from "./BotAvatar";
import { BotAvatarPicker } from "./BotAvatarPicker";
import { botAvatarAppearance, decodeBotAvatar, encodeBotAvatar } from "./botAvatarAppearance";
import { HARNESS_TITLE } from "../../sessions/model/session";

const avatarTabs = [{ id: "bot", label: "Bot" }, { id: "generate", label: "Generate" }, { id: "upload", label: "Upload" }];

export function BotIdentitySettings({ bot, busy, onSave, avatarSupported = false }: {
  bot: BotConfiguration; busy: boolean; onSave: (patch: BotPatch) => Promise<void>; avatarSupported?: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(bot.name), [avatar, setAvatar] = useState(bot.avatar ?? "");
  const visible = useSurfaceVisibility();
  const [editingAvatar, setEditingAvatar] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!visible) setEditingAvatar(false); }, [visible]);
  const closeEditor = () => { setEditingAvatar(false); trigger.current?.focus(); };
  const saveAvatar = async (next: string) => {
    await onSave({ name: name.trim() || bot.name, avatar: next });
    setAvatar(next); closeEditor();
  };
  const changed = name.trim() !== bot.name;
  return <form className="desktop-bot-identity" onSubmit={event => {
    event.preventDefault();
    if (changed && name.trim() && !busy) void onSave({ name: name.trim(), ...(avatarSupported ? { avatar } : {}) });
  }}>
    {avatarSupported ? <>
      <button ref={trigger} type="button" className="desktop-bot-avatar-trigger" aria-label={t("Edit avatar")} aria-haspopup="dialog" aria-expanded={editingAvatar} disabled={busy}
        onClick={() => setEditingAvatar(true)}>
        <BotAvatar bot={{ id: bot.id, avatar }} size={40} />
        <span className="desktop-bot-avatar-edit-overlay" aria-hidden="true"><Pencil size={14} /></span>
        <span className="desktop-bot-avatar-edit-hint" aria-hidden="true">{t("Edit avatar")}</span>
      </button>
      <PresenceBoundary>{editingAvatar && visible ? <AvatarDialog bot={bot} name={name.trim() || bot.name} avatar={avatar} busy={busy} onCancel={closeEditor} onSave={saveAvatar} /> : null}</PresenceBoundary>
    </> : <BotAvatar bot={{ id: bot.id, avatar }} size={40} />}
    <div className="desktop-bot-identity-text">
      <label className="desktop-bot-identity-name"><span className="sr-only">{t("Name")}</span><Input value={name} maxLength={100} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <span className="desktop-bot-identity-model" title={bot.model}><span>{[HARNESS_TITLE[bot.harness], bot.model].filter(Boolean).join(" · ")}</span></span>
    </div>
    <AnimatedCollapse expanded={changed} className="desktop-bot-identity-save">
      <Button variant="primary" size="sm" type="submit" disabled={busy || !changed || !name.trim()}>{t("Save")}</Button>
    </AnimatedCollapse>
  </form>;
}

/** Centered avatar editor: choices on the left, a live preview and the save action on the right. */
function AvatarDialog({ bot, name, avatar, busy, onCancel, onSave }: {
  bot: BotConfiguration; name: string; avatar: string; busy: boolean; onCancel: () => void; onSave: (avatar: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(avatar), [tab, setTab] = useState("bot"), [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const choices = useRef<HTMLDivElement>(null);
  // Start on the current choice so arrow keys move within the selected group.
  useEffect(() => { choices.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus(); }, []);
  const disabled = busy || saving;
  const save = async () => {
    if (disabled || [...draft].length > 8) return;
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  };
  return <Modal title={t("Edit avatar")} minimalHeader fitViewport size="lg" className="desktop-bot-avatar-dialog" onClose={onCancel}>
    <div className="desktop-bot-avatar-dialog-body">
      <div ref={choices} role="group" aria-label={t("Edit avatar")} className="desktop-bot-avatar-dialog-choices">
        <h2 aria-hidden="true">{t("Edit avatar")}</h2>
        <div className="desktop-bot-avatar-tabs" role="tablist" aria-label={t("Edit avatar")} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = avatarTabs.findIndex(item => item.id === tab);
          const next = event.key === "Home" ? 0 : event.key === "End" ? avatarTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : avatarTabs.length - 1)) % avatarTabs.length;
          setTab(avatarTabs[next].id);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>
          {avatarTabs.map(item => <button key={item.id} id={`${id}-${item.id}-tab`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`${id}-${item.id}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{t(item.label)}</button>)}
        </div>
        <div id={`${id}-bot-panel`} role="tabpanel" aria-labelledby={`${id}-bot-tab`} hidden={tab !== "bot"} className="desktop-bot-avatar-tab-panel">
          <BotAvatarPicker value={decodeBotAvatar(draft) ?? botAvatarAppearance(bot.id)} disabled={disabled} onChange={value => setDraft(encodeBotAvatar(value))} />
        </div>
        <div id={`${id}-generate-panel`} role="tabpanel" aria-labelledby={`${id}-generate-tab`} hidden={tab !== "generate"} className="desktop-bot-avatar-tab-panel">
          <Textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t("Describe your avatar…")} aria-label={t("Describe your avatar…")} disabled={disabled} />
          <Button variant="secondary" type="button" className="desktop-bot-avatar-generate" disabled aria-describedby={`${id}-generation-unavailable`}>{t("Generate")}</Button>
          <small id={`${id}-generation-unavailable`}>{t("Avatar image generation is not available yet.")}</small>
        </div>
        <div id={`${id}-upload-panel`} role="tabpanel" aria-labelledby={`${id}-upload-tab`} hidden={tab !== "upload"} className="desktop-bot-avatar-tab-panel" tabIndex={0}>
          <small>{t("Avatar image uploads are not available yet.")}</small>
        </div>
      </div>
      <aside className="desktop-bot-avatar-dialog-preview">
        <p className="desktop-bot-avatar-dialog-name">{name}</p>
        <BotAvatar bot={{ id: bot.id, avatar: draft }} size={160} />
        <div className="desktop-bot-avatar-dialog-actions">
          <Button variant="ghost" type="button" disabled={disabled || !draft} onClick={() => setDraft("")}>{t("Reset")}</Button>
          <Button variant="primary" type="button" disabled={disabled || draft === avatar || [...draft].length > 8} onClick={() => void save()}>{t(saving ? "Saving…" : "Save")}</Button>
        </div>
      </aside>
    </div>
  </Modal>;
}
