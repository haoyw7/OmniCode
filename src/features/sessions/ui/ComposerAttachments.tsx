import { useLayoutEffect, useState } from "react";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { COMPOSER_MOTION_MS } from "../model/composerResize";
import type { Attachment } from "../model/session";
import { AttachmentList } from "./AttachmentList";

/** Composer attachment row: the row folds open/closed and chips grow in place. */
export function ComposerAttachments({ attachments, onRemove, className }: {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
  className?: string;
}) {
  return <AnimatedCollapse
    expanded={attachments.length > 0}
    motion="height"
    durationMs={COMPOSER_MOTION_MS}
    animateContentResize
    className="composer-attachments-collapse"
  >
    <RetainedAttachments attachments={attachments} onRemove={onRemove} className={className} />
  </AnimatedCollapse>;
}

function RetainedAttachments({ attachments, onRemove, className }: {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
  className?: string;
}) {
  const [rendered, setRendered] = useState(attachments);
  useLayoutEffect(() => {
    if (attachments.length) setRendered(attachments);
  }, [attachments]);
  // Keep the last chips during closing. AnimatedCollapse unmounts this child
  // when finished, releasing their data without a separate removal timer.
  return <AttachmentList
    animated
    className={className}
    attachments={rendered}
    onRemove={attachments.length ? onRemove : undefined}
  />;
}
