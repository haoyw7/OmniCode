import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { X } from "./icons";
import "./composer-notice.css";

export type ComposerNoticeTone = "danger" | "warning" | "info";

/** One prompt bar style for every composer: errors, limits, retries. */
export function ComposerNotice({
  tone = "danger",
  size = "default",
  icon,
  detail,
  actions,
  onDismiss,
  dismissLabel,
  maxHeight,
  role = "alert",
  className,
  children,
}: {
  tone?: ComposerNoticeTone;
  size?: "default" | "compact";
  icon?: ReactNode;
  /** Secondary text after the message, muted. */
  detail?: ReactNode;
  /** Usually `ComposerNoticeButton`s. */
  actions?: ReactNode;
  /** Shows the close button when set. */
  onDismiss?: () => void;
  dismissLabel?: string;
  maxHeight?: CSSProperties["maxHeight"];
  role?: "alert" | "status";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      className={className ? `composer-notice ${className}` : "composer-notice"}
      data-tone={tone}
      data-size={size}
      style={maxHeight == null ? undefined : { maxHeight }}
    >
      {icon ? <span className="composer-notice-icon">{icon}</span> : null}
      <span className="composer-notice-message">
        {children}
        {detail ? <span className="composer-notice-detail">{detail}</span> : null}
      </span>
      {actions}
      {onDismiss ? (
        <button
          type="button"
          className="composer-notice-dismiss"
          title={dismissLabel}
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X className={size === "compact" ? "size-3.5" : "size-4"} />
        </button>
      ) : null}
    </div>
  );
}

export function ComposerNoticeButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={
        className ? `composer-notice-action ${className}` : "composer-notice-action"
      }
    />
  );
}
