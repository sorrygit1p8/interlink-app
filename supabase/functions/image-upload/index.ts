import { Backend, cors, EdgeError, failure, json } from "../_shared/runtime.ts";
import { readImage, sanitizeImage } from "../_shared/image.ts";

Deno.serve(async (request: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      throw new EdgeError("METHOD_NOT_ALLOWED", 405);
    }
    const backend = new Backend();
    const user = await backend.user(request);
    const authorization = await backend.rpc<{ allowed: boolean }>(
      "interlink_upload_authorize",
      { user_id: user.id },
    );
    if (!authorization?.allowed) throw new EdgeError("FORBIDDEN", 403);
    const image = await sanitizeImage(
      await readImage(request),
      request.headers.get("content-type") ?? "",
    );
    const path = `${user.id}/${crypto.randomUUID()}.jpeg`;
    // Storage has an account-status trigger, including service-role writes, closing deletion races.
    await backend.request(`/storage/v1/object/avatars/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=60",
        "x-upsert": "false",
      },
      body: new Uint8Array(image.bytes).buffer,
    });
    return json(
      {
        path,
        mimeType: "image/jpeg",
        width: image.width,
        height: image.height,
      },
      201,
      headers,
    );
  } catch (error) {
    return failure(error, headers);
  }
});
