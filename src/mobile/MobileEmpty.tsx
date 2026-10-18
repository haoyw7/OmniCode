import type { ReactNode } from "react";

/** Titles and descriptions are localized by the calling surface. */
export function MobileEmpty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mobile-empty">
      <div className="mobile-empty-icon" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
