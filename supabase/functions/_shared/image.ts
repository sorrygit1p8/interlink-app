import { Image } from "imagescript";
import { EdgeError } from "./runtime.ts";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_EDGE = 4096;
export const MAX_PIXELS = 12_000_000;
export type Dimensions = {
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
};

function reject(): never {
  throw new EdgeError("INVALID_IMAGE", 422);
}
function bounded(width: number, height: number): void {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width < 1 ||
    height < 1 || width > MAX_EDGE || height > MAX_EDGE ||
    width * height > MAX_PIXELS
  ) reject();
}
function ascii(bytes: Uint8Array, start: number, count: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + count));
}
function u24(bytes: Uint8Array, start: number): number {
  return bytes[start]! | (bytes[start + 1]! << 8) | (bytes[start + 2]! << 16);
}

/** Validate encoded dimensions before allocation; MIME/extension alone is insufficient. */
export function inspectImage(
  bytes: Uint8Array,
  contentType: string,
): Dimensions {
  if (!bytes.length || bytes.length > MAX_BYTES) {
    throw new EdgeError("IMAGE_TOO_LARGE", 413);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  let mime: Dimensions["mime"];
  if (
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)
  ) {
    mime = "image/png";
    let offset = 8, seenHeader = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset), type = ascii(bytes, offset + 4, 4);
      if (offset + 12 + size > bytes.length) reject();
      if (!seenHeader && type !== "IHDR") reject();
      if (type === "IHDR") {
        if (seenHeader || size !== 13) reject();
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        bounded(width, height);
        seenHeader = true;
      }
      if (type === "acTL" || type === "fcTL" || type === "fdAT") reject();
      offset += size + 12;
      if (type === "IEND") {
        if (size !== 0 || offset !== bytes.length) reject();
        ended = true;
        break;
      }
    }
    if (!seenHeader || !ended) reject();
  } else if (
    bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    mime = "image/webp";
    if (view.getUint32(4, true) + 8 !== bytes.length) reject();
    let offset = 12,
      foundFrame = false,
      canvas: { width: number; height: number } | undefined;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4),
        size = view.getUint32(offset + 4, true),
        data = offset + 8;
      if (data + size > bytes.length) reject();
      if (type === "ANIM" || type === "ANMF") reject();
      if (type === "VP8X") {
        if (size !== 10 || canvas || (bytes[data]! & 0x02)) reject();
        canvas = {
          width: u24(bytes, data + 4) + 1,
          height: u24(bytes, data + 7) + 1,
        };
        bounded(canvas.width, canvas.height);
      } else if (type === "VP8 ") {
        if (
          foundFrame || size < 10 ||
          ascii(bytes, data + 3, 3) !== "\x9d\x01\x2a"
        ) reject();
        width = view.getUint16(data + 6, true) & 0x3fff;
        height = view.getUint16(data + 8, true) & 0x3fff;
        bounded(width, height);
        foundFrame = true;
      } else if (type === "VP8L") {
        if (foundFrame || size < 5 || bytes[data] !== 0x2f) reject();
        const bits = view.getUint32(data + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        bounded(width, height);
        foundFrame = true;
      }
      offset = data + size + (size % 2);
    }
    if (
      offset !== bytes.length || !foundFrame ||
      (canvas && (canvas.width !== width || canvas.height !== height))
    ) reject();
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = "image/jpeg";
    let offset = 2, foundFrame = false, ended = false, entropy = false;
    while (offset < bytes.length) {
      if (entropy) {
        while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
      }
      if (bytes[offset++] !== 0xff) reject();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (
        marker === 0 ||
        (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
      ) {
        if (!entropy) reject();
        continue;
      }
      entropy = false;
      if (marker === 0xd9) {
        ended = true;
        if (offset !== bytes.length) reject();
        break;
      }
      if (
        marker === undefined || marker === 0xd8 || offset + 2 > bytes.length
      ) reject();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) reject();
      const isFrame = [
        0xc0,
        0xc1,
        0xc2,
        0xc3,
        0xc5,
        0xc6,
        0xc7,
        0xc9,
        0xca,
        0xcb,
        0xcd,
        0xce,
        0xcf,
      ].includes(marker);
      if (isFrame) {
        if (foundFrame || length < 8 || ![0xc0, 0xc1, 0xc2].includes(marker)) {
          reject();
        }
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        bounded(width, height);
        foundFrame = true;
      }
      if (marker === 0xda) {
        if (!foundFrame) reject();
        entropy = true;
      }
      offset += length;
    }
    if (!foundFrame || !ended) reject();
  } else return reject();
  if (contentType.split(";")[0]?.trim().toLowerCase() !== mime) reject();
  bounded(width, height);
  return { width, height, mime };
}

/** Encoder-generated APP/COM segments are removed too: output has no EXIF/XMP/ICC/comments. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const pieces: Uint8Array[] = [bytes.subarray(0, 2)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) reject();
    const marker = bytes[offset + 1]!;
    if (marker === 0xda || marker === 0xd9) {
      pieces.push(bytes.subarray(offset));
      break;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) reject();
    if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
      pieces.push(bytes.subarray(offset, offset + length + 2));
    }
    offset += length + 2;
  }
  const result = new Uint8Array(
    pieces.reduce((size, piece) => size + piece.length, 0),
  );
  let position = 0;
  for (const piece of pieces) {
    result.set(piece, position);
    position += piece.length;
  }
  return result;
}

export async function sanitizeImage(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  inspectImage(bytes, contentType);
  try {
    const image = await Image.decode(bytes, { applyOrientation: true });
    bounded(image.width, image.height);
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    if (scale < 1) {
      image.resize(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
    }
    // A fresh raster prevents input metadata from ever reaching the encoder.
    const clean = new Image(image.width, image.height);
    clean.bitmap = image.bitmap.slice();
    const output = stripJpegMetadata(await clean.encodeJPEG({ quality: 82 }));
    inspectImage(output, "image/jpeg");
    return { bytes: output, width: clean.width, height: clean.height };
  } catch (error) {
    if (error instanceof EdgeError) throw error;
    throw new EdgeError("INVALID_IMAGE", 422);
  }
}

export async function readImage(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES)
  ) throw new EdgeError("IMAGE_TOO_LARGE", 413);
  if (!request.body) reject();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new EdgeError("IMAGE_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
