// Lightweight JPEG structure validation. This is intentionally not a pixel
// decoder; it validates the container markers and required frame/scan headers.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function isRestartMarker(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

function validateFrameHeader(bytes: Uint8Array, payloadStart: number, segmentLength: number): boolean {
  const payloadLength = segmentLength - 2;
  if (payloadLength < 6) return false;
  const height = readUint16(bytes, payloadStart + 1);
  const width = readUint16(bytes, payloadStart + 3);
  const components = bytes[payloadStart + 5];
  if (width === 0 || height === 0 || components === 0) return false;
  return payloadLength >= 6 + components * 3;
}

export function validateJpegStructure(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  let inScan = false;

  while (offset < bytes.length) {
    let marker: number;

    if (inScan) {
      // Entropy-coded data may contain 0xff00 byte stuffing and restart
      // markers. Any other marker terminates the scan and is parsed below.
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      marker = bytes[offset++];
      if (marker === 0x00 || isRestartMarker(marker)) continue;
      if (marker === 0xd9) return hasFrame && hasScan && offset === bytes.length;
      inScan = false;
    } else {
      if (bytes[offset] !== 0xff) return false;
      offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      marker = bytes[offset++];
      if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) return false;
    }

    // TEM is the only standalone non-restart marker permitted here.
    if (marker === 0x01) continue;
    if (isRestartMarker(marker)) return false;
    if (offset + 2 > bytes.length) return false;

    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    const payloadStart = offset + 2;

    if (SOF_MARKERS.has(marker)) {
      if (!validateFrameHeader(bytes, payloadStart, segmentLength)) return false;
      hasFrame = true;
    }

    offset += segmentLength;
    if (marker === 0xda) {
      hasScan = true;
      inScan = true;
    }
  }

  return false;
}
