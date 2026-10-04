export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type RequestBodyReadResult =
  | { status: "ok"; body: Uint8Array }
  | { status: "invalid_content_length" }
  | { status: "too_large" }
  | { status: "read_error" };

function declaredContentLength(req: Request): number | "invalid" | null {
  const header = req.headers.get("content-length");
  if (header === null) return null;
  const value = header.trim();
  if (!/^\d+$/.test(value)) return "invalid";
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : "invalid";
}

export async function readRequestBodyWithinLimit(req: Request): Promise<RequestBodyReadResult> {
  const declaredLength = declaredContentLength(req);
  if (declaredLength === "invalid") return { status: "invalid_content_length" };
  if (declaredLength !== null && declaredLength > MAX_IMAGE_BYTES) return { status: "too_large" };

  if (req.body === null) return { status: "ok", body: new Uint8Array() };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        try {
          await reader.cancel("request_body_too_large");
        } catch {
          // The limit decision is already made; cancellation is best effort.
        }
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "read_error" };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", body };
}
