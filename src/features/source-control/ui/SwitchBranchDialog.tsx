import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/forms/Button";
import { Textarea } from "../../../shared/ui/forms/Textarea";
import { WandSparkles, X } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { generateCommitMessage } from "../../../integrations/harness";
import { MOD } from "../../../platform/tauri/platform";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

type Busy = "stash" | "commit" | null;

type Props = {
  cwd: string;
  branch: string;
  creating?: boolean;
  busy: Busy;
  error?: string | null;
  onStash: () => void;
  onCommit: (message: string) => void;
  onCancel: () => void;
};

export function SwitchBranchDialog({
  cwd,
  branch,
  creating = false,
  busy,
  error,
  onStash,
  onCommit,
  onCancel,
}: Props) {
  const { t: uiT } = useTranslation();
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const generateAbortRef = useRef<AbortController | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = message.trim();
  const canCommit = trimmed.length > 0 && !busy && !generating;

  useEffect(() => {
    messageRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      if (generateAbortRef.current) {
        generateAbortRef.current.abort();
        generateAbortRef.current = null;
        setGenerating(false);
      }
    },
    [cwd],
  );

  useEffect(() => {
    const el = messageRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [message]);


  const generate = async () => {
    if (busy || generating || generateAbortRef.current) return;
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setGenerating(true);
    try {
      const generated = await generateCommitMessage(
        cwd,
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) setMessage(generated);
    } catch (err) {
      if (!controller.signal.aborted) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
        setGenerating(false);
        messageRef.current?.focus();
      }
    }
  };

  const cancelGenerate = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setGenerating(false);
    messageRef.current?.focus();
  };

  return (
    <Modal title={uiT("Uncommitted changes")} size="sm" onClose={() => { if (!busy && !generating) onCancel(); }}>
      <div aria-busy={Boolean(busy) || generating} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-[12px] leading-snug text-content/55">
            {creating
              ? uiT(
                  "Creating “{value0}” would overwrite your local changes. Stash them for later, or commit them on this branch first.",
                  { value0: String(branch) },
                )
              : uiT(
                  "Switching to “{value0}” would overwrite your local changes. Stash them for later, or commit them on this branch first.",
                  { value0: String(branch) },
                )}
          </p>
        </div>

        <div className="relative">
          <Textarea
            data-code-label
            ref={messageRef}
            rows={1}
            value={message}
            placeholder={uiT("Message ({value0}↩ to commit)", {
              value0: String(MOD),
            })}
            disabled={Boolean(busy) || generating}
            aria-label={uiT("Commit message")}
            className="max-h-40 w-full resize-none overflow-y-auto rounded-md bg-content/10 py-1 pr-8 pl-2 text-[13px] leading-5 text-content outline-none placeholder:text-content/35 disabled:opacity-40"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                canCommit
              ) {
                event.preventDefault();
                onCommit(trimmed);
              }
            }}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            title={
              generating
                ? uiT("Cancel commit message generation")
                : uiT("Generate commit message")
            }
            aria-label={
              generating
                ? uiT("Cancel commit message generation")
                : uiT("Generate commit message")
            }
            disabled={Boolean(busy)}
            onClick={() => (generating ? cancelGenerate() : void generate())}
            className="group absolute top-1 right-1 grid size-5 place-items-center rounded-md bg-content/10 text-content hover:bg-content/14 hover:text-content disabled:opacity-40"
          >
            {generating ? (
              <>
                <Spinner className="size-3.5 group-hover:hidden group-focus-visible:hidden" />
                <X
                  className="hidden size-3.5 group-hover:block group-focus-visible:block"
                />
              </>
            ) : (
              <WandSparkles className="size-3" />
            )}
          </Button>
        </div>

        {error ? (
          <p className="whitespace-pre-wrap text-[11px] leading-4 text-danger/90">
            {error}
          </p>
        ) : null}

        <ModalFooter>
          <Button
            variant="secondary"
            type="button"
            disabled={Boolean(busy) || generating}
            onClick={onCancel}
          >
            {uiT("Cancel")}
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!canCommit}
            onClick={() => onCommit(trimmed)}
          >
            {busy === "commit" ? (
              <Spinner className="size-3.5" />
            ) : null}
            {uiT("Commit & switch")}
          </Button>
          <Button
            type="button"
            disabled={Boolean(busy) || generating}
            onClick={onStash}
          >
            {busy === "stash" ? (
              <Spinner className="size-3.5" />
            ) : null}
            {uiT("Stash & switch")}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
