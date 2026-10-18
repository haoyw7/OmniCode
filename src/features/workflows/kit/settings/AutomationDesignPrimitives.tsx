// Icons the saved-workflows hub shares with ZCode's automations (Apache-2.0
// packages/ui/src/settings/AutomationIcons.tsx), on Lucide.
import { Ellipsis, Play, RefreshCw, Trash2, type IconProps as LucideProps } from "../../../../shared/ui/icons";

const ICON_PROPS = { size: 16, strokeWidth: 2 } as const;

export function AutomationRunNowIcon(props: LucideProps) {
  return <Play {...ICON_PROPS} {...props} />;
}

export function AutomationMoreHorizontalIcon(props: LucideProps) {
  return <Ellipsis {...ICON_PROPS} {...props} />;
}

export function AutomationRefreshIcon(props: LucideProps) {
  return <RefreshCw {...ICON_PROPS} {...props} />;
}

export function AutomationTrashIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
      <Trash2 className="size-4" {...ICON_PROPS} />
    </span>
  );
}
