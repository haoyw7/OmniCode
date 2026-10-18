// Monocode shim for ZCode's file icon descriptor: a document glyph.
import { FileText } from "../../../../shared/ui/icons";

export function resolveFileDisplayDescriptor(_name: string): { fileIconSrc: string } {
  return { fileIconSrc: "markdown" };
}

export function FileDisplayIcon({ className }: { src?: string; className?: string }) {
  return <FileText className={className} aria-hidden="true" />;
}
