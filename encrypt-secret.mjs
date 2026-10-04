// Encrypts a device secret in the exact format _shared/deviceAuth.ts expects:
//   base64( nonce[24 bytes] || crypto_secretbox_easy(secret, nonce, key) )
//
// Usage (secrets are read from environment variables, so they are not typed into the script):
//   npm install libsodium-wrappers
//   DEVICE_SECRET_KEY_HEX=<64 hex chars> DEVICE_SECRET=<the secret in your sketch> node encrypt-secret.mjs
//
// Windows PowerShell:
//   $env:DEVICE_SECRET_KEY_HEX="<64 hex chars>"; $env:DEVICE_SECRET="<secret>"; node encrypt-secret.mjs

import sodium from "libsodium-wrappers";

await sodium.ready;

const keyHex = process.env.DEVICE_SECRET_KEY_HEX ?? "";
const secret = process.env.DEVICE_SECRET ?? "";

if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error("DEVICE_SECRET_KEY_HEX must be exactly 64 hex characters");
if (!secret) throw new Error("DEVICE_SECRET is empty");

const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
const box = sodium.crypto_secretbox_easy(secret, nonce, sodium.from_hex(keyHex));

const packed = new Uint8Array(nonce.length + box.length);
packed.set(nonce);
packed.set(box, nonce.length);

console.log(sodium.to_base64(packed, sodium.base64_variants.ORIGINAL));
