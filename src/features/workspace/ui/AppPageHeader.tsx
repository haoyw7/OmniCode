import { createContext, useContext, type ReactNode } from "react";
import { ArrowLeft, type IconComponent } from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";

/** The shell may place a visible page's header in its window chrome. */
export const AppPageHeaderPortalContext = createContext<((header: ReactNode) => ReactNode) | null>(null);

export function AppPageHeader({
  title,
  icon: Icon,
  onBack,
}: {
  title: string;
  icon: IconComponent;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const renderInChrome = useContext(AppPageHeaderPortalContext);
  const visible = useContext(SurfaceVisibilityContext);
  const header = (
    <div data-app-page-header className="desktop-toolbar flex h-10 shrink-0 select-none items-center gap-2 border-b border-stroke px-3 text-[13px]">
      {onBack ? (
        <button
          type="button"
          data-tauri-drag-region="false"
          aria-label={t("Back to chat")}
          title={t("Back to chat")}
          onClick={onBack}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/6 hover:text-content"
        >
          <ArrowLeft className="size-3.5" />
        </button>
      ) : null}
      <Icon className="size-3.5 shrink-0 text-content/45" />
      <span className="min-w-0 truncate text-content">{title}</span>
    </div>
  );
  return renderInChrome && visible ? renderInChrome(header) : header;
}
