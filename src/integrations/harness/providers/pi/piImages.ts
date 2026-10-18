import { isTauri } from "@tauri-apps/api/core";
import {
  saveGeneratedImage,
  deleteGeneratedImages,
} from "../../../../platform/tauri/fs";
import type { PiImageMaterializer } from "./piFamily";

/** Hosts persist bytes themselves; desktop Pi and OMP use Tauri's image store. */
export function piImageMaterializer(): PiImageMaterializer | undefined {
  if (!(typeof isTauri === "function" && isTauri())) return undefined;
  return async (image) => {
    const asset = await saveGeneratedImage({
      data: image.data,
      name: image.name,
    });
    return {
      event: {
        type: "image.generated",
        itemId: image.itemId,
        agentCallId: image.agentCallId,
        path: asset.path,
        name: image.name,
        mimeType: asset.mimeType,
        size: asset.size,
      },
      discard: () => deleteGeneratedImages([asset.path]),
    };
  };
}
