import { assert, assertEquals } from "jsr:@std/assert@1";
import { MAX_IMAGE_BYTES, readRequestBodyWithinLimit } from "./requestBody.ts";

function request(bytes: Uint8Array, contentLength?: string): Request {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("https://example.test", { method: "POST", headers, body: bytes });
}

Deno.test("accepts body below the 5 MiB limit", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await readRequestBodyWithinLimit(request(bytes));
  assertEquals(result.status, "ok");
  if (result.status === "ok") assertEquals(Array.from(result.body), Array.from(bytes));
});

Deno.test("accepts body exactly at the 5 MiB limit", async () => {
  const bytes = new Uint8Array(MAX_IMAGE_BYTES);
  const result = await readRequestBodyWithinLimit(request(bytes));
  assertEquals(result.status, "ok");
});

Deno.test("rejects streamed body above the 5 MiB limit", async () => {
  const bytes = new Uint8Array(MAX_IMAGE_BYTES + 1);
  const result = await readRequestBodyWithinLimit(request(bytes));
  assertEquals(result.status, "too_large");
});

Deno.test("rejects invalid Content-Length before reading", async () => {
  const result = await readRequestBodyWithinLimit(request(new Uint8Array(), "not-a-number"));
  assertEquals(result.status, "invalid_content_length");
});

Deno.test("rejects declared Content-Length above 5 MiB before reading", async () => {
  const result = await readRequestBodyWithinLimit(request(new Uint8Array(), String(MAX_IMAGE_BYTES + 1)));
  assertEquals(result.status, "too_large");
});
