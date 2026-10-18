import {
  Archive,
  ArrowDownCircle,
  AudioLines,
  Bell,
  Bot,
  CodeXml,
  Computer,
  Eye,
  Gauge,
  Globe,
  Laptop,
  Link,
  MessageMultiple,
  Palette,
  Play,
  Sparkles,
  SquarePen,
  SunMoon,
  Terminal,
  UserRound,
  Vibrate,
  Volume2,
} from "../shared/ui/icons";

const glyphs = {
  agent: Bot,
  account: UserRound,
  appearance: SunMoon,
  language: Globe,
  notifications: Bell,
  followUp: SquarePen,
  glass: Sparkles,
  intensity: Gauge,
  transparency: Eye,
  accent: Palette,
  sounds: Volume2,
  haptics: Vibrate,
  outputHaptics: AudioLines,
  play: Play,
  layout: MessageMultiple,
  archive: Archive,
  updates: ArrowDownCircle,
  link: Link,
  code: CodeXml,
  terminal: Terminal,
  laptop: Laptop,
  desktop: Computer,
};

export type MobileSettingsIconName = keyof typeof glyphs;

export function MobileSettingsGlyph({
  name,
}: {
  name: MobileSettingsIconName;
}) {
  const Icon = glyphs[name];
  return (
    <Icon size={24} strokeWidth={1.75} aria-hidden="true" focusable="false" />
  );
}

export function MobileSettingsIcon({ name }: { name: MobileSettingsIconName }) {
  return (
    <span className="mobile-settings-icon" aria-hidden="true">
      <MobileSettingsGlyph name={name} />
    </span>
  );
}
