import type { ReactNode } from "react";
import { Empty, EmptyMedia } from "../shared/ui/primitives/Empty";

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
    <Empty className="mobile-empty">
      <EmptyMedia className="mobile-empty-icon">{icon}</EmptyMedia>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </Empty>
  );
}
