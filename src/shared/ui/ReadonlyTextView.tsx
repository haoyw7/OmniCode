import { createContext, lazy, memo, Suspense } from "react";
import "./readonly-text.css";

const Editor = lazy(() => import("./ReadonlyTextEditor"));

/** Limit both tokenization cost and DOM lines, including tiny lines. */
export function isLongText(text: string): boolean {
  if (text.length > 24_000) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) === 10 && ++lines > 300) return true;
  return false;
}

/** Navigation retains only small reading positions, never editors or documents. */
export const ReadonlyTextStateContext = createContext<
  Map<string, unknown> | undefined
>(undefined);
export interface ReadonlyTextProps {
  text: string;
  line?: number;
  startLine?: number;
  stateKey?: string;
  diff?: boolean;
  onCopy?: (text: string) => Promise<unknown>;
}

export const ReadonlyTextView = memo(function ReadonlyTextView(
  props: ReadonlyTextProps,
) {
  return (
    <Suspense
      fallback={
        <div
          className="readonly-text-view readonly-text-viewport"
          aria-busy="true"
        />
      }
    >
      <Editor key={props.stateKey} {...props} />
    </Suspense>
  );
});
