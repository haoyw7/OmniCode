import { remoteRequest } from "./connections";
import { loadRemoteHostDescriptor } from "./remoteHostMetadata";
import { sharedHostMachineId, sharedHostEnvironment } from "./remoteProjects";
import { HOST_INBOX_MEDIA_CAPABILITY, HOST_LINK_PREVIEW_CAPABILITY, type BinaryTransfer, type BinaryTransferChunk, type LinkPreviewMetadata } from "../../../contracts/hostMedia";
import { translate } from "../../../shared/i18n/language";

async function mediaHost(capability: string) {
  const machine = sharedHostMachineId();
  if (!machine) throw new Error(translate("Shared conversation service is not connected"));
  const descriptor = await loadRemoteHostDescriptor(machine, sharedHostEnvironment() ?? "");
  if (!descriptor.capabilities.includes(capability)) throw new Error(translate("Update Host to load media previews."));
  return machine;
}

export const hostMediaScope = () => `${sharedHostMachineId() ?? ""}:${sharedHostEnvironment() ?? ""}`;

export async function fetchHostLinkPreview(url: string): Promise<LinkPreviewMetadata> {
  return remoteRequest(await mediaHost(HOST_LINK_PREVIEW_CAPABILITY), "links.preview", { url });
}

export async function fetchHostInboxMedia(url: string): Promise<Uint8Array> {
  const machine = await mediaHost(HOST_INBOX_MEDIA_CAPABILITY);
  const transfer = await remoteRequest<BinaryTransfer>(machine, "media.inbox", { url });
  if (!transfer || typeof transfer.transfer !== "string" || !Number.isSafeInteger(transfer.size) || transfer.size <= 0 || transfer.size > 25 * 1024 * 1024)
    throw new Error("Invalid media transfer");
  const result = new Uint8Array(transfer.size);
  let offset = 0;
  while (offset < transfer.size) {
    const chunk = await remoteRequest<BinaryTransferChunk>(machine, "media.chunk", { transfer: transfer.transfer, offset });
    if (typeof chunk.data !== "string" || chunk.size !== transfer.size || !Number.isSafeInteger(chunk.offset) || chunk.offset <= offset || chunk.offset > transfer.size)
      throw new Error("Invalid media transfer");
    const data = atob(chunk.data);
    if (data.length !== chunk.offset - offset) throw new Error("Invalid media transfer");
    for (let i = 0; i < data.length; i++) result[offset + i] = data.charCodeAt(i);
    offset = chunk.offset;
  }
  return result;
}
