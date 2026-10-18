import { useContext, useEffect, useRef, useState } from "react";
import { Check, Copy } from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { playCue } from "../../settings/model/sounds";
import type { Attachment } from "../model/session";
import { TranscriptPlatformContext } from "./TranscriptPlatform";

export function CopyTurnButton({
  text,
  attachments,
  label = "Copy response",
}: {
  text: string;
  attachments?: Attachment[];
  label?: string;
}) {
  const { copyMessage } = useContext(TranscriptPlatformContext);
  const { t: uiT } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setCopied(false);
    setError(null);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [text, attachments]);

  return (
    <>
      <button
        data-ui="response-action"
        type="button"
        disabled={pending}
        title={copied ? uiT("Copied") : label}
        aria-label={copied ? uiT("Copied") : label}
        className="-ml-1 rounded-md p-1 text-content/40 hover:bg-content/5 hover:text-content/70"
        onClick={(event) => {
          event.stopPropagation();
          setError(null);
          setCopied(false);
          setPending(true);
          playCue("copy");
          void copyMessage(text, attachments).then(
            () => {
              setPending(false);
              setCopied(true);
              if (timer.current != null) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setCopied(false), 2000);
            },
            (error: unknown) => {
              setPending(false);
              setError(error instanceof Error ? error.message : String(error));
            },
          );
        }}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-content/70">
          {uiT("Copy failed. ")}
          {error}
        </span>
      )}
    </>
  );
}

