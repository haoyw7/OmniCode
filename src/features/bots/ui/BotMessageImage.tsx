import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { botPanelKey } from "../model/botPanelQueries";
import type { RemoteAttachment } from "../../connections/model/protocol";
import { AttachmentChip } from "../../sessions/ui/AttachmentChip";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

export type ReadBotImage = (messageId: string, file: RemoteAttachment) => Promise<string>;

/** Preview bytes stay local; the public timeline retains its small attachment references. */
export function BotMessageImage({ messageId, file, readImage }: {
  messageId: string;
  file: RemoteAttachment;
  readImage: ReadBotImage;
}) {
  const visible = useSurfaceVisibility();
  const preview = useQuery({
    queryKey: [...botPanelKey(readImage), "image", messageId, file.id, file.mimeType, file.size],
    queryFn: ({ signal }) => { signal.throwIfAborted(); return readImage(messageId, file); },
    enabled: visible,
    staleTime: Infinity,
    gcTime: 0,
  }, queryClient);
  // Older Hosts or missing bytes retain the filename fallback.
  return <AttachmentChip attachment={{ ...file, data: preview.data }} />;
}
