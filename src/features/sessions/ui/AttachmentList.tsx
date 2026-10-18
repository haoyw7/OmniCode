import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useEffect, type HTMLAttributes, type ReactNode } from "react";
import { autoAnimateOptions } from "../../../shared/motion/tokens";
import type { Attachment } from "../model/session";
import { AttachmentChip } from "./AttachmentChip";

/** Shared attachment list; AutoAnimate retains removals and reflows chips. */
export function AttachmentList<T extends Attachment>({ attachments, onRemove, renderAttachment, animated = false, style, ...props }: HTMLAttributes<HTMLDivElement> & {
  attachments: T[]; onRemove?: (id: string) => void; renderAttachment?: (attachment: T) => ReactNode; animated?: boolean;
}) {
  const [list, enable] = useAutoAnimate<HTMLDivElement>(autoAnimateOptions);
  useEffect(() => enable(animated), [animated, enable]);
  return <div {...props} ref={animated ? list : undefined} style={style} className={`${animated ? "attachment-list-animated" : ""}${props.className ? ` ${props.className}` : ""}`}>
    {attachments.map(file => <div key={file.id} className={animated ? "attachment-presence" : undefined} data-attachment-id={file.id}>
      {renderAttachment ? renderAttachment(file) : <AttachmentChip attachment={file} onRemove={onRemove ? () => onRemove(file.id) : undefined} />}
    </div>)}
  </div>;
}

type Presence<T> = { attachment: T; leaving: boolean };

/** Keeps removed chips at their previous position until they finish leaving. */
export function mergeAttachmentPresence<T extends Attachment>(previous: Presence<T>[], next: T[]): Presence<T>[] {
  const ids = new Set(next.map(file => file.id));
  const result: Presence<T>[] = next.map(attachment => ({ attachment, leaving: false }));
  previous.forEach((item, index) => {
    if (ids.has(item.attachment.id)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const found = result.findIndex(entry => entry.attachment.id === previous[before].attachment.id);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    result.splice(at, 0, { attachment: item.attachment, leaving: true });
  });
  return result;
}
