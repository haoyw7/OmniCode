import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";

type Props = {
  busy: boolean;
  error?: string | null;
  onCreate: (name: string) => void;
  onCancel: () => void;
};

export function CreateBranchDialog({ busy, error, onCreate, onCancel }: Props) {
  const { t: uiT } = useTranslation();
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || busy) return;
    onCreate(trimmed);
  };

  return (
    <Modal
      title={uiT("New branch")}
      description={uiT("Create and check out a branch in this project.")}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">
            {uiT("Branch name")}
          </span>
          <input data-ui="input"
            data-code-label
            ref={input}
            type="text"
            value={name}
            placeholder="feature/my-branch"
            aria-label={uiT("Branch name")}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            className="h-9 rounded-md border border-content/10 bg-content/5 px-2.5 font-sans text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25 disabled:opacity-50"
          />
        </label>

        {error ? (
          <p role="alert" className="text-[11px] leading-4 text-red-400/90">
            {error}
          </p>
        ) : null}

        <ModalFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {uiT("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!trimmed || busy}>
            {busy ? (
              <Loader className="size-3.5 animate-spin" />
            ) : null}
            {uiT("Create branch")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
