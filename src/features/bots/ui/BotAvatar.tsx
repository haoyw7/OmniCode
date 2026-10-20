import { Omi } from "../../../shared/ui/branding/Omi";
import { botAvatarAppearance, decodeBotAvatar } from "./botAvatarAppearance";

type Identity = { id: string; avatar?: string };

export function BotAvatar({ bot, size = 40 }: { bot: Identity; size?: 22 | 24 | 28 | 36 | 40 | 72 | 96 | 160 }) {
  const selected = decodeBotAvatar(bot.avatar);
  const appearance = selected ?? botAvatarAppearance(bot.id);
  return <span className="desktop-bot-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * .46 }}>
    {bot.avatar && !selected ? <span>{bot.avatar}</span> : <Omi compact animated expression={appearance.expression} shape={appearance.shape} variant={appearance.variant} width={size} height={size} focusable="false" style={{ color: `var(--color-omi-${appearance.tone}, currentColor)` }} />}
  </span>;
}
