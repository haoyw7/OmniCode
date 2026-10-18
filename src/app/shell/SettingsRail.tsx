import { useTranslation } from "../../shared/i18n/useTranslation";
import {
  Archive,
  Bot,
  FileImport,
  Inbox,
  FolderTree,
  Globe,
  Internet,
  Keyboard,
  MessageSquare,
  Palette,
  SlidersHorizontal,
  Sparkles,
  type IconComponent,
} from "../../shared/ui/icons";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import {
  settingsSectionsByGroup,
  type SettingsSectionId,
} from "../../features/settings/model/settings";

const SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
  general: SlidersHorizontal,
  connections: Internet,
  appearance: Palette,
  keybindings: Keyboard,
  chat: MessageSquare,
  providers: Bot,
  import: FileImport,
  mcp: Globe,
  skills: Sparkles,
  inbox: Inbox,
  worktrees: FolderTree,
  archive: Archive,
};

type Props = {
  section: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
};

/** Navigation owned by the Settings workspace view. */
export function SettingsNav({ section, onSelect }: Props) {
  const { t: uiT } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLElement>();

  return (
    <nav
      ref={lockOverscroll}
      aria-label={uiT("Settings")}
      className="settings-nav flex min-h-0 shrink-0 flex-col overflow-y-auto overscroll-none border-r border-stroke"
    >
      {settingsSectionsByGroup().map((group) => (
        <div key={group.id} className="settings-nav-group flex flex-col">
          <div className="px-2 pb-1 text-xs font-semibold text-content/35">
            {group.label}
          </div>
          {group.sections.map((item) => (
            <NavRow
              key={item.id}
              label={item.label}
              icon={SECTION_ICONS[item.id]}
              active={item.id === section}
              onClick={() => onSelect(item.id)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function NavRow({
  label,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`settings-nav-item flex w-full items-center text-left ${
        active
          ? "bg-surface-hover text-content"
          : "text-foreground-subtle hover:bg-surface-hover hover:text-content"
      }`}
    >
      <Icon className="settings-nav-icon shrink-0 opacity-70" />
      <span className="settings-nav-label min-w-0 flex-1 truncate font-medium">
        {label}
      </span>
    </button>
  );
}
