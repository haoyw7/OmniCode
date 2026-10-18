import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useState } from "react";
import { X } from "../../../shared/ui/icons";
import { attachmentPreviewSrc, isAttachmentFolder } from "../model/attachments";
import { attachmentThumbnail } from "../model/attachmentThumbnails";
import type { Attachment } from "../model/session";
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
  /** Sent files render as image-sized tiles instead of compact chips. */
  tile?: boolean;
  /** Opens a sent file in its own tab. */
  onOpen?: () => void;
};

export function AttachmentChip({ attachment, onRemove, tile = false, onOpen }: Props) {
  const { t: uiT } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  // A cached thumbnail spares the chip from decoding the full photo.
  const thumbnail = attachment.kind === "image" ? attachmentThumbnail(attachment.id) : undefined;
  const preview = thumbnail ?? attachmentPreviewSrc(attachment);
  const image = attachment.kind === "image" && preview;
  const fileTile = tile && !image;
  const openLabel = uiT("Open {value0}", { value0: String(attachment.name) });
  const extension = /\.([^./\\]+)$/.exec(attachment.name)?.[1];
  const typeLabel = isAttachmentFolder(attachment)
    ? uiT("Folder")
    : extension ? extension.toUpperCase() : uiT("File");

  return (
    <>
      <div
        className={`group relative flex min-w-0 items-center gap-1.5 rounded-md ${
          image
            ? "attachment-chip-image"
            : fileTile
              ? "attachment-chip-file"
              : `bg-content/10 py-0.5 pl-1 ${onRemove ? "pr-4" : "pr-1"}`
        }`}
        title={attachment.path ?? attachment.name}
      >
        {image ? (
          <button
            type="button"
            aria-label={uiT("Open {value0} full screen", {
              value0: String(attachment.name),
            })}
            title={uiT("Open {value0} full screen", {
              value0: String(attachment.name),
            })}
            onClick={(event) => {
              event.stopPropagation();
              setPreviewOpen(true);
            }}
            className="shrink-0 cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <img
              src={preview}
              alt=""
              decoding="async"
              draggable={false}
              className="attachment-chip-thumbnail size-9 rounded-lg object-cover"
            />
          </button>
        ) : fileTile ? (
          <button
            type="button"
            disabled={!onOpen}
            aria-label={onOpen ? openLabel : attachment.name}
            title={onOpen ? openLabel : (attachment.path ?? attachment.name)}
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.();
            }}
            className="attachment-chip-card enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="attachment-chip-card-icon">
              <FileTypeIcon
                name={attachment.name}
                isDir={isAttachmentFolder(attachment)}
                size={22}
              />
            </span>
            <span className="attachment-chip-card-text">
              <span data-file-label className="attachment-chip-card-name">{attachment.name}</span>
              <span className="attachment-chip-card-type">{typeLabel}</span>
            </span>
          </button>
        ) : (
          <>
            <span className="grid size-5 shrink-0 place-items-center">
              <FileTypeIcon
                name={attachment.name}
                isDir={isAttachmentFolder(attachment)}
                size={16}
              />
            </span>
            <span data-file-label className="min-w-0 max-w-[140px] truncate text-[11px] leading-none text-content/80">
              {attachment.name}
            </span>
          </>
        )}
        {onRemove ? (
          <button
            type="button"
            title={uiT("Remove")}
            aria-label={uiT("Remove {value0}", {
              value0: String(attachment.name),
            })}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="attachment-chip-remove absolute -right-1 -top-1 grid size-5 shrink-0 place-items-center rounded-full bg-content/20 text-content/70 opacity-100 shadow-sm backdrop-blur-sm hover:bg-content/15 hover:text-content"
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <PresenceBoundary>{image && previewOpen ? (
        <ImageLightbox
          src={thumbnail ? (attachmentPreviewSrc(attachment) ?? thumbnail) : preview}
          alt={attachment.name}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}</PresenceBoundary>
    </>
  );
}
