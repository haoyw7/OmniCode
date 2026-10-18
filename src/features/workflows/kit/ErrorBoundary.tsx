// Monocode shim for ZCode's ScopedErrorBoundary: contain a crashed subtree.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "../../../shared/lib/cn";
import { workflowIntl } from "./i18n/IntlProvider.js";
import { logger } from "./logger.js";

interface ScopedErrorBoundaryProps {
  children: ReactNode;
  scope: string;
  resetKeys?: readonly unknown[];
  variant?: "compact" | "inline" | "panel";
  className?: string;
  onReset?: () => void;
  onCaughtReactError?: (error: Error, errorInfo: ErrorInfo, scope: string) => void;
}

export class ScopedErrorBoundary extends Component<ScopedErrorBoundaryProps, { error: Error | null; keys?: readonly unknown[] }> {
  override state: { error: Error | null; keys?: readonly unknown[] } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ScopedErrorBoundaryProps, state: { error: Error | null; keys?: readonly unknown[] }) {
    const keys = props.resetKeys;
    const changed = keys && state.keys && (keys.length !== state.keys.length || keys.some((key, index) => !Object.is(key, state.keys![index])));
    return changed ? { error: null, keys } : { keys };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(`[ScopedErrorBoundary:${this.props.scope}] subtree crashed`, { message: error.message });
    this.props.onCaughtReactError?.(error, errorInfo, this.props.scope);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={cn("rounded-md border border-border px-3 py-2 text-ui-sm text-foreground-subtle", this.props.className)}>
        {workflowIntl.formatMessage({ id: "workflow.errorBoundary", defaultMessage: "This view could not be shown." })}
      </div>
    );
  }
}
