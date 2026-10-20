export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

/** Preserve the strict PNG path for older providers, and validate native WB images. */
export function decodeGeneratedImage(data: string, mimeType = "image/png"): Uint8Array {
  const mime = mimeType.trim().toLowerCase();
  if (mime === "image/png") return decodeGeneratedPng(data);
  if (mime !== "image/jpeg" && mime !== "image/webp") throw new Error("Unsupported generated image type");
  const encoded = data.replace(new RegExp(`^data:${mime};base64,`), "");
  if (encoded.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4) throw new Error("Generated image exceeds 20 MiB");
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid generated image base64");
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_GENERATED_IMAGE_BYTES) throw new Error("Generated image exceeds 20 MiB");
  if (mime === "image/jpeg") {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
      throw new Error("Invalid generated JPEG image");
    let offset = 2, dimensions = false;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("Invalid generated JPEG marker");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) throw new Error("Invalid generated JPEG segment");
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8 || !(bytes[offset + 3] * 256 + bytes[offset + 4]) || !(bytes[offset + 5] * 256 + bytes[offset + 6])) throw new Error("Invalid generated JPEG dimensions");
        dimensions = true;
      }
      offset += length;
    }
    if (!dimensions) throw new Error("Invalid generated JPEG dimensions");
  } else {
    const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
    const view = new DataView(bytes.buffer);
    if (bytes.length < 26 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP" || view.getUint32(4, true) + 8 !== bytes.length
      || !["VP8 ", "VP8L", "VP8X"].includes(ascii(12, 4)) || view.getUint32(16, true) > bytes.length - 20)
      throw new Error("Invalid generated WebP image");
  }
  return bytes;
}

/** Shared desktop/Host bounds; no Node dependency in browser-facing adapters. */
export function decodeGeneratedPng(data: string): Uint8Array {
  const encoded = data.replace(/^data:image\/png;base64,/, "");
  if (encoded.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4)
    throw new Error("Generated image exceeds 20 MiB");
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new Error("Invalid generated image base64");
  const binary = atob(encoded);
  if (binary.length > MAX_GENERATED_IMAGE_BYTES)
    throw new Error("Generated image exceeds 20 MiB");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const header = [73, 72, 68, 82];
  const end = [73, 69, 78, 68];
  if (
    bytes.length < 45 ||
    !signature.every((byte, index) => bytes[index] === byte) ||
    !header.every((byte, index) => bytes[index + 12] === byte) ||
    !end.every((byte, index) => bytes[bytes.length - 8 + index] === byte)
  )
    throw new Error("Invalid generated PNG image");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || !view.getUint32(16) || !view.getUint32(20))
    throw new Error("Invalid generated PNG dimensions");
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12)
      throw new Error("Invalid generated PNG chunk");
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + length; index++)
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 255];
    if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(offset + 8 + length))
      throw new Error("Invalid generated PNG checksum");
    if (
      bytes[offset + 4] === 73 &&
      bytes[offset + 5] === 68 &&
      bytes[offset + 6] === 65 &&
      bytes[offset + 7] === 84
    )
      imageData = true;
    offset += length + 12;
  }
  if (!imageData || offset !== bytes.length)
    throw new Error("Incomplete generated PNG image");
  return bytes;
}
