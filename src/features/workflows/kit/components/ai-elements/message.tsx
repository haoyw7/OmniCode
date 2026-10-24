// OmniCode shim for ZCode's MessageResponse: OmniCode's markdown renderer.
import type { ReactNode } from "react";
import { AgentMarkdown } from "../../../../../shared/ui/markdown/AgentMarkdown";

export function MessageResponse({ children, className }: { children?: ReactNode; className?: string; theme?: unknown }) {
  return <AgentMarkdown text={typeof children === "string" ? children : String(children ?? "")} {...(className ? { className } : {})} />;
}
