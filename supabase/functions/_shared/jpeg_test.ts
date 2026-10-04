import { assert, assertFalse } from "jsr:@std/assert@1";
import { validateJpegStructure } from "./jpeg.ts";

function structuralJpeg(sofMarker = 0xc0, width = 1, height = 1, includeScan = true): Uint8Array {
  const bytes = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, sofMarker, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x01, 0x11, 0x00,
  ];
  if (includeScan) bytes.push(
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  );
  else bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

Deno.test("accepts a baseline structural JPEG", () => {
  assert(validateJpegStructure(structuralJpeg()));
});

Deno.test("accepts a progressive structural JPEG", () => {
  assert(validateJpegStructure(structuralJpeg(0xc2)));
});

Deno.test("rejects marker-only fake JPEG", () => {
  assertFalse(validateJpegStructure(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])));
});

Deno.test("rejects truncated JPEG", () => {
  const jpeg = structuralJpeg();
  assertFalse(validateJpegStructure(jpeg.slice(0, -2)));
});

Deno.test("rejects malformed segment length", () => {
  assertFalse(validateJpegStructure(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x20, 0x00, 0xff, 0xd9])));
});

Deno.test("rejects missing SOS", () => {
  assertFalse(validateJpegStructure(structuralJpeg(0xc0, 1, 1, false)));
});

Deno.test("rejects missing SOF", () => {
  assertFalse(validateJpegStructure(new Uint8Array([
    0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  ])));
});

Deno.test("rejects zero width or height", () => {
  assertFalse(validateJpegStructure(structuralJpeg(0xc0, 0, 1)));
  assertFalse(validateJpegStructure(structuralJpeg(0xc0, 1, 0)));
});
