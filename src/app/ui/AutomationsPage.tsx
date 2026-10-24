import type { ComponentProps } from "react";
import { AutomationsView } from "../../features/automations/ui/AutomationsView";
import { SearchableProjectPicker } from "../../features/projects/ui/SearchableProjectPicker";
import { AutomationRuntimeControls } from "./AutomationRuntimeControls";

export function AutomationsPage(props: Omit<ComponentProps<typeof AutomationsView>, "ProjectPicker" | "RuntimeControls">) {
  return <AutomationsView {...props} ProjectPicker={SearchableProjectPicker} RuntimeControls={AutomationRuntimeControls} />;
}
