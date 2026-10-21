import { Button } from "../../../shared/ui/forms/Button";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { toast } from "sonner";
import type { RemoteAttachment } from "../../connections/model/protocol";
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import { formatFileSize } from "../../connections/files/model/filePreview";
import { Download, Loader2 } from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { botErrorMessage } from "../model/botErrors";

export function BotAttachmentCard({ file, onOpen, read }: { file: RemoteAttachment; onOpen?: () => void; read: () => Promise<string> }) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const downloadMutation = useMutation({
    mutationFn: async ({ read, file }: { read: () => Promise<string>; file: RemoteAttachment }) => {
      const data = await read();
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      try {
        const link = document.createElement("a"); link.href = url; link.download = file.name; link.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    },
    onError: (cause) => toast.error(t(botErrorMessage(cause))),
    gcTime: 0,
  }, queryClient);
  const busy = downloadMutation.isPending;
  const error = downloadMutation.error && botErrorMessage(downloadMutation.error);
  const download = () => { if (!busy && visible) downloadMutation.mutate({ read, file }); };
  return <div className="desktop-bot-file-card">
    <Button variant="ghost" size="content" type="button" className="desktop-bot-file-open" onClick={onOpen ?? (() => void download())} disabled={busy || !visible} aria-label={t("Open {value0}", { value0: file.name })}>
      <span className="desktop-bot-file-icon"><FileTypeIcon name={file.name} isDir={false} size={24} /></span>
      <span><strong data-file-label>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
    </Button>
    <Button variant="ghost" size="icon-sm" type="button" className="assistant-icon-button" aria-label={t("Download {name}", { name: file.name })} disabled={busy || !visible} onClick={() => void download()}>{busy ? <Loader2 size={17} /> : <Download size={17} />}</Button>
    {error && <small role="alert">{t(error)}</small>}
  </div>;
}
