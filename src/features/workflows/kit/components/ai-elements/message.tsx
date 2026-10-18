// Monocode shim for ZCode's MessageResponse: Monocode's markdown renderer.
import type { ReactNode } from "react";
import { AgentMarkdown } from "../../../../sessions/ui/AgentMarkdown";

export function MessageResponse({ children, className }: { children?: ReactNode; className?: string; theme?: unknown }) {
  return <AgentMarkdown text={typeof children === "string" ? children : String(children ?? "")} {...(className ? { className } : {})} />;
}
