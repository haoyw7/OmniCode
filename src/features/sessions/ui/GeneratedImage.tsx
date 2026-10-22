import { Button } from "../../../shared/ui/forms/Button";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { transcriptImageQuery } from "../model/transcriptImageQueries";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { formatFileSize, sniffImageMime } from "../../connections/files/model/filePreview";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import type { GeneratedImageMeta, Attachment } from "../model/session";

export function GeneratedImage({ image, attachment }: { image: GeneratedImageMeta; attachment?: Attachment }) {
  const { readBinaryFile } = useContext(TranscriptPlatformContext);
  const { t: uiT } = useTranslation();
  const imageQuery = useQuery({ ...transcriptImageQuery(image.path, readBinaryFile), enabled: !attachment }, queryClient);
  const bytes = imageQuery.data;
  const [preview, setPreview] = useState<{ bytes: Uint8Array; url: string }>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const [open, setOpen] = useState(false);
  const attachmentUrl = attachment?.previewUrl || (attachment?.data ? `data:${attachment.mimeType};base64,${attachment.data}` : undefined);
  const mime = bytes && sniffImageMime(bytes);
  const url = attachment ? attachmentUrl : preview?.bytes === bytes ? preview?.url : undefined;
  const size = attachment ? attachment.size : bytes?.byteLength ?? 0;
  useEffect(() => {
    if (attachment || !bytes || !mime) return;
    const created = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setPreview({ bytes, url: created });
    return () => URL.revokeObjectURL(created);
  }, [bytes, mime, !!attachment]);
  useEffect(() => { setOpen(false); }, [image.path, readBinaryFile, attachment?.id]);

  if (!attachment && (imageQuery.isPending || (!!mime && !url))) {
    return (
      <div className="px-4 py-3 text-xs text-content/45" role="status">
        {uiT("Loading generated image…")}
      </div>
    );
  }

  if (!url || url === failedUrl || (!attachment && imageQuery.isError)) {
    return (
      <div className="px-4 py-3 text-xs text-content/50" role="alert">
        {uiT("Could not open generated image.")}
      </div>
    );
  }

  const alt = image.alt || image.name;
  return (
    <div className="min-w-0 px-4 pb-3 pt-3">
      <Button variant="ghost" size="content"
        type="button"
        aria-label={uiT("Open {value0} full screen", {
          value0: String(image.name),
        })}
        title={uiT("Open {value0} full screen", { value0: String(image.name) })}
        onClick={() => setOpen(true)}
        className="block max-w-full cursor-zoom-in overflow-hidden rounded-xl border border-content/10 bg-content/5"
      >
        <img
          src={url}
          onError={() => setFailedUrl(url)}
          alt={alt}
          draggable={false}
          className="max-h-[min(70vh,640px)] max-w-full object-contain"
        />
      </Button>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-content/45">
        <span className="truncate">{image.name}</span>
        <span>{formatFileSize(size)}</span>
      </div>
      <PresenceBoundary>{open ? (
        <ImageLightbox
          src={url}
          alt={alt}
          onClose={() => setOpen(false)}
        />
      ) : null}</PresenceBoundary>
    </div>
  );
}
