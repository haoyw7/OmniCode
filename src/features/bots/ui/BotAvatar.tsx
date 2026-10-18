type Identity = { id: string; avatar?: string };
const palette = ["#c7b8f5", "#ffd19d", "#b4ddc4", "#f3b9cb", "#a8d8eb", "#e6d48f"];
const shapes = [
  "M18 74C7 58 13 22 32 17C42 3 64 9 70 21C93 23 97 64 79 78C66 96 29 94 18 74Z",
  "M13 65C6 42 24 33 25 19C28 6 45 13 50 21C60 4 78 9 78 29C99 41 90 66 84 78C70 93 27 96 13 65Z",
  "M14 39C19 17 36 25 43 12C53 2 68 17 77 20C95 27 92 50 87 63C96 84 70 94 54 86C35 97 10 78 17 63C7 56 8 48 14 39Z",
];

/** Stable across Hosts, reloads and themes; no random values or SVG resource IDs. */
export function botAvatarSeed(id: string) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  return { color: palette[hash % palette.length], shape: shapes[(hash >>> 8) % shapes.length], eyes: 43 + (hash % 7) };
}

export function BotAvatar({ bot, size = 40 }: { bot: Identity; size?: 22 | 24 | 28 | 36 | 40 | 72 | 96 }) {
  const seed = botAvatarSeed(bot.id);
  return <span className="desktop-bot-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * .46 }}>
    {bot.avatar ? <span>{bot.avatar}</span> : <svg viewBox="0 0 100 100" width={size} height={size} focusable="false">
      <path d={seed.shape} fill={seed.color} />
      <circle cx="38" cy={seed.eyes} r="4" fill="#252334" />
      <circle cx="62" cy={seed.eyes} r="4" fill="#252334" />
    </svg>}
  </span>;
}
