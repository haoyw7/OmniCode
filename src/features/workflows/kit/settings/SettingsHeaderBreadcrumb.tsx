// Monocode shim: ZCode reports breadcrumbs to its settings header; Monocode's
// Workflows view renders its own header, so the reporter renders nothing.
export interface SettingsBreadcrumbItem {
  label: string;
  onSelect?: () => void;
}

export function SettingsBreadcrumbReporter(_props: { items: readonly SettingsBreadcrumbItem[]; onSectionSelect?: () => void }) {
  return null;
}
