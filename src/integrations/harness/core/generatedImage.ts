export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

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
