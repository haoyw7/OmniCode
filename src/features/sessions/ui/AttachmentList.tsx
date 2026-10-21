import { cn } from "../../../shared/lib/cn";
import { type HTMLAttributes, type ReactNode } from "react";
import { ListMotion, ListMotionItem } from "../../../shared/ui/ListMotion";
import type { Attachment } from "../model/session";
import { AttachmentChip } from "./AttachmentChip";

export function AttachmentList<T extends Attachment>({ attachments, onRemove, renderAttachment, animated = false, style, ...props }: HTMLAttributes<HTMLDivElement> & {
  attachments: T[]; onRemove?: (id: string) => void; renderAttachment?: (attachment: T) => ReactNode; animated?: boolean;
}) {
  return <div {...props} style={style} className={cn(animated && "attachment-list-animated", props.className)}>
    <ListMotion enabled={animated}>
    {attachments.map(file => <ListMotionItem key={file.id} className={animated ? "attachment-presence" : undefined} data-attachment-id={file.id}>
      {renderAttachment ? renderAttachment(file) : <AttachmentChip attachment={file} onRemove={onRemove ? () => onRemove(file.id) : undefined} />}
    </ListMotionItem>)}
    </ListMotion>
  </div>;
}
