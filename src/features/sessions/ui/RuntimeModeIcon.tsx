import {
  Lock,
  Pencil,
  Shield,
  Sparkles,
  type IconComponent,
  type IconProps,
} from "../../../shared/ui/icons";
import type { RuntimeMode } from "../model/session";

const ICONS: Record<RuntimeMode, IconComponent> = {
  supervised: Lock,
  "auto-accept-edits": Pencil,
  auto: Sparkles,
  "full-access": Shield,
};

export function RuntimeModeIcon({
  mode,
  ...props
}: IconProps & { mode: RuntimeMode }) {
  const Icon = ICONS[mode];
  return <Icon {...props} />;
}
