# Device and API architecture

```text
ESP32 / ESP32-CAM -> Wi-Fi + HTTPS -> Supabase Edge Functions -> PostgreSQL
Next.js dashboard -> Supabase client + Auth/RLS -> PostgreSQL
```

There is no PHP API or `warehouse-api/` directory in this project.

## Phase 9 function surface

These functions authenticate the raw request body with the Phase 6 device-auth
flow. The Phase 7 `access-event` function also performs staff RFID authorization
and writes the resulting access log.

| Function | Method | Purpose | Main tables later involved |
| --- | --- | --- | --- |
| `heartbeat` | POST | Device liveness and pending-command count | `devices`, future command table |
| `device-config` | GET | Device assignment and non-secret configuration | `devices`, `warehouses`, `warehouse_areas` |
| `access-event` | POST | Staff RFID authorization decision | `access_logs`, `devices`, `warehouse_areas`, `access_credentials`, `access_permissions` |
| `truck-plate` | POST | Authenticated JPEG capture, Plate Recognizer lookup, and truck-entrance authorization | `trucks`, `access_logs`, `devices`, `warehouse_areas`, `access_permissions` |
| `sensor-reading` | POST | DHT22 temperature/humidity reading and environmental evaluation | `sensor_readings`, `devices`, `device_safety_config` |
| `safety-event` | POST | Safety or emergency event | `safety_events`, emergency state, areas |
| `area-status` | POST | Logical area state update | `warehouse_areas`, `devices` |

The unified access event distinguishes `staff_rfid`, `staff_pin`, `truck_plate`,
and `truck_rfid`. The existing schema and event vocabulary can represent truck
plate outcomes. Phase 16 adds the authenticated `truck-plate` Edge Function;
the ESP32-CAM upload and physical camera integration remain pending.

## Request contracts

Shared interfaces are in `supabase/functions/_shared/api.ts` and mirror the
Phase 2 column names. They contain no device secrets, PIN values, HMAC keys, or
hardware pin assignments.

For staff RFID and keypad PIN access, `access-event` accepts only the logical
`area_id`, `credential_type` (`staff_rfid` or `staff_pin`), and a 64-character
lowercase hexadecimal `credential_hash`. The server derives the device, staff
member, credential, permission, event type, and result. RFID hashes are SHA-256
of the canonical RFID UID; PIN hashes are SHA-256 of the canonical digit
string. No plaintext RFID UID or PIN is sent or logged.

The response is `{"status":"authorized"}` for an allowed scan or
`{"status":"denied","reason":"..."}` for an unknown, inactive, or
unauthorized credential. Invalid requests return `400`; device-auth failures
remain `401`.

`truck-plate` accepts an authenticated raw JPEG request body with
`Content-Type: image/jpeg`. The exact binary body is authenticated using the
same `X-Device-UID`, `X-Timestamp`, and `X-Signature` headers; the signed
message is `timestamp + "." + exact raw JPEG bytes`. The function forwards the
image as a multipart upload to Plate Recognizer Snapshot Cloud, requesting the
documented Philippines region code `ph`. The provider token is read only from
the server-side `PLATE_RECOGNIZER_API_TOKEN` secret.

The request body is limited to 5 MiB. When present, `Content-Length` must be a
valid non-negative integer; an invalid value returns `400`, and a declaration
over 5 MiB returns `413` before the body is read. Requests without an
over-limit declaration are still read through the request stream with a
running 5 MiB limit; a body that exceeds the limit also returns `413`. The
function retains the exact bytes collected from that stream for HMAC
verification and provider upload.

Before the provider lookup, the body undergoes lightweight structural JPEG
validation. It checks the JPEG marker structure, segment lengths, a SOF frame
with non-zero dimensions, an SOS scan, and a final EOI marker. It is not a
pixel decoder. Invalid or truncated JPEG structure returns `400`; the wrong
media type returns `415`.

The function validates the provider response, normalizes the candidate using
the shared deterministic Phase 16 contract, and looks up an active registered
truck within the authenticated Device's warehouse. It then checks the truck's
permission for the `truck_entrance` area and writes the existing
`TRUCK_PLATE_SUCCESS` or `TRUCK_PLATE_DENIED` access log. OCR output alone
cannot authorize access. Images are not stored or logged. Invalid JPEGs,
provider failures, missing plates, unknown trucks, inactive trucks, and
missing permissions fail closed.

Configure the provider token only in the target Supabase project's server-side
secrets:

```text
supabase secrets set PLATE_RECOGNIZER_API_TOKEN=<YOUR_PRIVATE_TOKEN> --project-ref odavmzgciaoahebanpmy
```

Never place the token in firmware, dashboard code, `.env` files, logs, or
documentation.

For development, send a real JPEG fixture with `curl --data-binary` to the
deployed or locally served function. The request must be signed over the exact
bytes that are sent; do not use `-d`, JSON, multipart wrapping, or a re-encoded
copy of the fixture. The endpoint performs one provider lookup per incoming
request and does not retry automatically. A fixture test still requires a
provisioned test Device and warehouse context; this repository does not seed
those records.

`sensor-reading` accepts `temperature_c` and `humidity_pct`, with optional
`smoke_value` for the Phase 10 Safety Sensor Unit. `smoke_value` is a generic
raw/normalized measurement and is not ppm. DHT22-only submissions remain valid.
The server derives `device_id` and `warehouse_id` from authenticated device
HMAC credentials; client-supplied `device_id`, `smoke_detected`, and
`fire_detected` fields are rejected. Values must be finite and within DHT22
sensor-domain bounds
(-40 to 80 C and 0 to 100 percent humidity). The server stores the reading and
returns the evaluated `environmental_state` when device-specific thresholds
are configured. Supplied smoke values must be finite and non-negative; absent
smoke values are not fabricated.

Threshold comparison is upper-bound based: `DANGER` takes precedence when
either value reaches its danger threshold; otherwise `WARNING` applies when
either value reaches its warning threshold; otherwise the state is `NORMAL`.
Missing configuration records the raw reading without an evaluated state and
returns `configuration_status: "missing"`.

Smoke warning and danger values are device-specific and owner-managed. A smoke
value reaches `WARNING` or `DANGER` according to those thresholds when supplied.
No smoke sensor model, unit, or calibration is assumed.

The Safety Sensor Unit submits DHT22 measurements on its existing sampling
cadence. Smoke is included in the same request only when a valid smoke reading
is available; unavailable smoke hardware is omitted rather than represented by
zero or stale data.

When thresholds are configured, the server atomically stores the reading,
updates the authenticated Device's current environmental state, and creates an
`ENVIRONMENTAL_STATE_CHANGED` safety event only when the state differs from the
previous state. The first configured reading establishes the Device state
without fabricating a previous state or creating a transition event. Repeated
readings at the same state create no duplicate events. The response includes
the current state, previous state, and whether a transition event was created.

`safety-event` accepts the `safety_events` event type, severity, status,
emergency state, timestamps, area/device identifiers, and metadata.

`area-status` accepts an `area_id` and one of `locked`, `unlocked`, or
`emergency_release`. This is logical state, not a physical servo assignment.

Phase 13 does not change the access-event API. The firmware uses the existing
`{"status":"authorized"}` or `{"status":"denied"}` response as the input to
the local actuator layer. Authorization remains server-side; the servo layer
does not contain credential or permission rules.

Phase 14 also uses these existing responses for local-only buzzer/LCD feedback.
Sensor responses may update an informational safety message when the server
returns `NORMAL`, `WARNING`, or `DANGER`. No new feedback endpoint or dashboard
control is added. Phase 15 activates emergency coordination only from a
successful authenticated sensor response whose server-derived state is
`DANGER`; client emergency flags are not accepted.

Phase 16 does not accept a client-provided `authorized` flag, truck ID,
warehouse ID, or plate text as an authorization decision. The `truck-plate`
function validates the Plate Recognizer response, normalizes the candidate,
resolves it against the authenticated device's warehouse and registered truck
records, checks truck-entrance permission, writes the existing truck-plate
access-log outcome, and returns the existing authorized/denied response.

## Response and security behavior

The functions return `405` for an unsupported method, `401` with the generic
`authentication_failed` message for any authentication failure, and `500` for
unexpected server failures. RFID authorization decisions return `200` and are
written to the existing `access_logs` table using the corresponding
`STAFF_RFID_*` or `STAFF_PIN_*` event. Service-role credentials are never
exposed.

The future Next.js dashboard will use Supabase Auth, the public Supabase URL,
and the publishable key. The service-role key will not be placed in browser code
or `.env.example`.
