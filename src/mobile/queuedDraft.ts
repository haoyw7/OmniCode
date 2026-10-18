import type {
  Attachment,
  QueuedMessage,
} from "../features/sessions/model/session";
import { readQueuedAttachmentPreviews } from "./attachments";

/** Prepare previews before removal; a lost removal receipt must retain the draft. */
export async function takeBackQueuedMessage(
  message: QueuedMessage,
  actions: {
    read: Parameters<typeof readQueuedAttachmentPreviews>[1];
    remove: (id: string) => Promise<void>;
    pendingRemoval: (id: string) => Promise<boolean>;
    current: () => boolean;
    restore: (attachments: Attachment[]) => void;
  },
) {
  const attachments = await readQueuedAttachmentPreviews(
    message.attachments,
    actions.read,
  );
  if (!actions.current()) return;
  try {
    await actions.remove(message.id);
  } catch (reason) {
    if (actions.current() && (await actions.pendingRemoval(message.id)))
      actions.restore(attachments);
    throw reason;
  }
  if (actions.current()) actions.restore(attachments);
}
