import { Image } from "imagescript";
import { inspectImage, MAX_BYTES, readImage, sanitizeImage } from "./image.ts";
import { EdgeError } from "./runtime.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejects(action: () => unknown, code: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof EdgeError && error.code === code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

Deno.test("raster decode converts PNG to bounded JPEG and removes private metadata", async () => {
  const fixture = new Image(1400, 700).fill(0xb7ff32ff);
  const bytes = await fixture.encode({
    metadata: { author: "PRIVATE-NAME", comment: "PRIVATE-GPS-LOCATION" },
  });
  const result = await sanitizeImage(bytes, "image/png");
  assert(result.width === 1024 && result.height === 512);
  assert(inspectImage(result.bytes, "image/jpeg").mime === "image/jpeg");
  const text = new TextDecoder("latin1").decode(result.bytes);
  assert(
    !text.includes("PRIVATE") && !text.includes("Exif") &&
      !text.includes("ImageScript"),
  );
  const decoded = await Image.decode(result.bytes);
  assert(decoded.width === 1024 && decoded.height === 512);
});
Deno.test("JPEG input roundtrips without original EXIF", async () => {
  const fixture = new Image(24, 16).fill(0xff0000ff);
  const bytes = await fixture.encodeJPEG({
    quality: 80,
    metadata: { author: "PERSONAL-AUTHOR" },
  });
  const output = await sanitizeImage(bytes, "image/jpeg");
  assert(output.width === 24 && output.height === 16);
  assert(!new TextDecoder().decode(output.bytes).includes("PERSONAL"));
});
Deno.test("WebP input is decoded and re-encoded as JPEG", async () => {
  const bytes = await new Image(16, 16).fill(0xb7ff32ff).encodeWebP();
  const output = await sanitizeImage(bytes, "image/webp");
  assert(
    output.width === 16 &&
      inspectImage(output.bytes, "image/jpeg").height === 16,
  );
});
Deno.test("SVG and HTML spoofed as PNG are rejected before decoding", async () => {
  await rejects(
    () =>
      sanitizeImage(
        new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
        "image/png",
      ),
    "INVALID_IMAGE",
  );
  await rejects(
    () =>
      sanitizeImage(
        new TextEncoder().encode("<html>not an image</html>"),
        "image/jpeg",
      ),
    "INVALID_IMAGE",
  );
});
Deno.test("MIME does not override magic bytes", async () => {
  const png = await new Image(2, 2).encode();
  await rejects(() => inspectImage(png, "image/jpeg"), "INVALID_IMAGE");
});
Deno.test("large declared pixel dimensions are rejected before decode", async () => {
  const png = await new Image(2, 2).encode();
  const mutated = png.slice();
  new DataView(mutated.buffer).setUint32(16, 100_000);
  await rejects(() => inspectImage(mutated, "image/png"), "INVALID_IMAGE");
});
Deno.test("truncated and animated containers are rejected", async () => {
  const png = await new Image(2, 2).encode();
  await rejects(
    () => inspectImage(png.slice(0, -5), "image/png"),
    "INVALID_IMAGE",
  );
  const fakeAnimation = png.slice();
  fakeAnimation.set(new TextEncoder().encode("acTL"), 37);
  await rejects(
    () => inspectImage(fakeAnimation, "image/png"),
    "INVALID_IMAGE",
  );
});
Deno.test("streaming size limit is enforced without Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await rejects(
    () =>
      readImage(
        new Request("https://local.test/upload", {
          method: "POST",
          body: stream,
        }),
      ),
    "IMAGE_TOO_LARGE",
  );
  assert(cancelled);
});
