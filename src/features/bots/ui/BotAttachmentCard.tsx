import { useState } from "react";
import type { RemoteAttachment } from "../../connections/model/protocol";
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import { formatFileSize } from "../../connections/files/model/filePreview";
import { Download, Loader2 } from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { botErrorMessage } from "../model/botErrors";

export function BotAttachmentCard({ file, onOpen, read }: { file: RemoteAttachment; onOpen?: () => void; read: () => Promise<string> }) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const download = async () => {
    if (busy || !visible) return;
    setBusy(true); setError(undefined);
    try {
      const data = await read();
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      const link = document.createElement("a"); link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <div className="desktop-bot-file-card">
    <button type="button" className="desktop-bot-file-open" onClick={onOpen ?? (() => void download())} disabled={busy || !visible} aria-label={t("Open {value0}", { value0: file.name })}>
      <span className="desktop-bot-file-icon"><FileTypeIcon name={file.name} isDir={false} size={24} /></span>
      <span><strong data-file-label>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
    </button>
    <button data-ui="icon-button" type="button" className="assistant-icon-button" aria-label={t("Download {name}", { name: file.name })} disabled={busy || !visible} onClick={() => void download()}>{busy ? <Loader2 size={17} /> : <Download size={17} />}</button>
    {error && <small role="alert">{t(error)}</small>}
  </div>;
}
