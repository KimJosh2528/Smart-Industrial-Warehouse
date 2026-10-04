# Phase 6 device authentication

The final project authenticates ESP32 requests at the Supabase Edge Function
boundary. Every device request carries:

```text
X-Device-UID: <registered device UID>
X-Timestamp: <Unix seconds>
X-Signature: <lowercase hexadecimal HMAC-SHA256>
```

The signed message is exactly:

```text
timestamp + "." + raw HTTP request body
```

The handler reads the body once, authenticates that exact representation, and
only then may later code parse it. Text request bodies continue to use the
existing string path. The Phase 16 `truck-plate` function uses a binary
`Uint8Array` path for JPEG capture: the HMAC input is the UTF-8 timestamp prefix
followed directly by the exact JPEG bytes. No JSON reconstruction, decoding,
or base64 conversion is used before verification.

The Phase 16 binary body is collected through a bounded request stream. The
5 MiB maximum is checked from `Content-Length` when available and enforced
again while reading; an invalid declaration returns `400`, and an over-limit
declaration or body returns `413`. Structural JPEG validation happens after
the exact bytes are collected and does not alter the bytes used for HMAC.

## Server flow

`supabase/functions/_shared/deviceAuth.ts` validates header format and requires
the timestamp to be within 60 seconds of server time. The device is resolved by
`devices.device_uid` using the server-only Supabase service-role credential.
Inactive, missing, malformed, or unknown devices all produce the same `401
authentication_failed` response.

`devices.device_secret_encrypted` stores `base64(nonce || ciphertext)` using
libsodium Secretbox with a 24-byte nonce. The `DEVICE_SECRET_KEY_HEX` Edge
Function secret is only the reversible encryption key for this database value.
It is not the HMAC key. After decryption, the device's original secret is used
as the HMAC-SHA256 key and is never returned or logged.

After a valid signature, the server atomically advances `devices.last_nonce_ts`
only when the incoming timestamp is greater than the stored watermark. This
prevents reuse of an otherwise valid request, including within the 60-second
tolerance window. The same update records `last_seen_at`.

The Edge Function uses `SUPABASE_SERVICE_ROLE_KEY` only server-side because the
device lookup and replay-watermark update must operate across RLS policies. The
credential is never sent to firmware, the dashboard, an API response, or logs.

## Database changes

Migration `20260918000300_device_authentication.sql` adds nullable provisioning
columns to the existing `devices` table: `device_uid`,
`device_secret_encrypted`, `last_nonce_ts`, and `last_seen_at`. A partial unique
index prevents duplicate provisioned UIDs. Existing unprovisioned rows remain
available for controlled provisioning; no secret values are seeded.

## Firmware flow

`firmware/include/device_auth.h` uses the ESP32 mbedTLS SHA-256 HMAC primitive.
`api_client.h` signs the exact body it sends and adds all three headers. NTP
must report a valid synchronized Unix timestamp before a request is sent.
The device secret is supplied only by a private ignored firmware configuration
overlay through `FirmwareConfig::deviceSecret`; the repository contains an
empty placeholder and no production credential. It is never printed or sent
except as the HMAC key input inside the device.

`device-config` and all Phase 6 device endpoints use the same authentication:
heartbeat, device-config, access-event, sensor-reading, safety-event, and
area-status. Phase 6 stops after authenticated transport; hardware-specific
business logic is not implemented.

## Failure and secret handling rules

Missing or malformed headers, stale/future timestamps, unknown or inactive
devices, decryption failures, bad signatures, and replayed timestamps return
the same 401 response. Internal failures return a generic 500 response. No
failure response contains a secret, expected signature, or cryptographic
diagnostic.

Device configuration responses contain no device secret, encryption key, HMAC
key, registration key, or plaintext credential. The reference PHP project was
not modified.
