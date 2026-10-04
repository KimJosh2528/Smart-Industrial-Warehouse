# ESP32 DHT22 safety sensor foundation

This is the Phase 9 DHT22 foundation for the final Smart Industrial
Warehouse project. It is a PlatformIO ESP32 project and contains no PHP backend,
hardware drivers, GPIO assignments, or production credentials.

## Build

Open `firmware/` in PlatformIO and run the normal PlatformIO build. The project
uses the `esp32dev` board and the Arduino framework.

Configuration placeholders are in `include/config.h`. Keep local credentials,
device secret, and CA certificates outside version control. The default
configuration refuses to send until URL, TLS CA, device identity, and the
private device secret are configured.

## Structure

- `platformio.ini`: PlatformIO environment
- `include/config.h`: safe configuration interface/placeholders
- `include/wifi_manager.h`: bounded Wi-Fi connection/retry behavior
- `include/time_manager.h`: bounded NTP synchronization and timestamp checks
- `include/device_auth.h`: HMAC-SHA256 request signer
- `include/rfid.h`: reader-independent RFID interface, UID canonicalization,
  hashing, and repeated-scan suppression
- `include/keypad.h`: reader-independent keypad interface, bounded PIN input,
  timeout, clear/cancel handling, and PIN hashing
- `include/dht22.h`: DHT22 adapter with invalid-value checks and interval-based
  sampling
- `include/camera.h`: model-neutral ESP32-CAM capture boundary with explicit
  unavailable, failed, and succeeded states
- `include/plate_workflow.h`: server-side OCR boundary and existing
  server-decision-to-servo adapter; no local plate allowlist or OCR parser
- `include/api_client.h`: reusable HTTPS GET/POST API client
- `src/main.cpp`: boot, Wi-Fi/NTP foundation, and heartbeat foundation check

## Networking behavior

Wi-Fi connection attempts are bounded to five seconds and retry later instead of
blocking the future hardware loop forever. Serial output reports connection,
IP, and RSSI without printing passwords.

NTP must provide a valid Unix timestamp before a request can proceed. No fake
timestamps are used. If time is unavailable, the request is blocked safely.

HTTPS uses `WiFiClientSecure::setCACert()` with a configured CA certificate. The
foundation does not use `setInsecure()` or another TLS bypass. Until a CA
certificate and real project URL are configured locally, the API client refuses
to send.

## Phase 4 endpoint mapping

The API client prepares methods for:

- `POST /heartbeat`
- `GET /device-config`
- `POST /access-event`
- `POST /sensor-reading`
- `POST /safety-event`
- `POST /area-status`

The request bodies are passed as exact raw JSON strings. A caller must keep the
same string for future signing and transmission; it must not parse and rebuild
the JSON between those operations.

## Device headers and HMAC

The request headers are:

```text
X-Device-UID
X-Timestamp
X-Signature
```

The intended signed message is:

```text
timestamp + "." + exact raw request body
```

For a GET request, the raw body is empty, so the message is `timestamp + "."`.

`RequestSigner::signRequest()` is fail-closed when the private device secret is
not configured. It never logs or displays the secret or generated signature.

## RFID access foundation

The project currently has no confirmed RFID reader model or approved GPIO
mapping. `include/rfid.h` therefore provides a reader-independent interface;
it does not add an MFRC522 dependency and does not invent pins. A future
hardware adapter must implement `RfidReaderInterface::begin()` and
`readUid()` for the confirmed reader.

The canonical UID representation is lowercase hexadecimal, two characters per
raw UID byte, with no separators. The credential sent to `POST /access-event`
is SHA-256 of that canonical UID, encoded as lowercase hexadecimal. The server
matches it against `access_credentials.credential_hash` and checks the staff
member's permission for the configured logical `area_id`.

The same physical reader can be reused sequentially for the approved logical
areas. `FirmwareConfig::rfidDemoAreaId` is intentionally empty until a real
warehouse-area UUID is selected; no area UUID or area name is hardcoded.

Repeated scans of the same UID are suppressed for 1500 ms. A scan after the
suppression interval is treated as a new demonstration attempt. No servo,
buzzer, LCD, keypad, camera, or sensor behavior is part of this phase.

`classifyAccessResponse()` distinguishes authorized, denied,
authentication-failure, network-failure, server-failure, and invalid responses.
An HTTP or transport failure is never silently converted into access denial.

## Keypad PIN foundation

The keypad uses the same authenticated `POST /access-event` path as RFID, with
`credential_type: "staff_pin"`. The PIN manager accepts digits only, defaults to
4–6 digits, confirms with `#`, clears with `*`, and cancels with `C`. These keys
are configuration values because the physical keypad model is not confirmed.
Input expires after 15 seconds of inactivity and is cleared after submission,
clear, cancel, timeout, or invalid confirmation. The plaintext PIN is never
printed, sent, or logged; only its SHA-256 hexadecimal representation is sent.

This SHA-256 representation follows the existing `credential_hash` schema and
is suitable for the current foundation. A server-side brute-force/rate-limit
policy remains a future security enhancement and is not claimed to exist here.

## Phase 16 truck plate foundation

The ESP32-CAM is treated as a component of the authenticated mother Device;
no second Device UID, secret, warehouse, or owner is created. The camera
boundary is model-neutral because the board model, GPIO map, frame size, JPEG
quality, flash behavior, and PSRAM requirements are not confirmed. The
unassigned driver produces no image bytes. Capture explicitly reports
unavailable, failed, or succeeded and releases captured memory through the
driver boundary without logging raw image bytes.

`ServerOcrInterface` is an integration boundary only. OCR provider selection,
credentials, image transport, and runtime recognition remain pending. The
firmware contains no plate allowlist, hardcoded plate, fake image, fake OCR
result, or plate-normalization algorithm. No existing normalization function
was found in the repository, so no conflicting algorithm was invented.

When the server-side OCR and authorization path is selected, its final
`authorized`/`denied` response must enter the existing `DoorAccessController`
through `TruckPlateAccessAdapter`; OCR text itself cannot unlock a door.
Unknown plates, OCR failures, malformed responses, and network/authentication
failures therefore remain fail-closed through the existing access classifier.

## Safety Sensor Unit foundation

The DHT22 is part of the one logical Safety Sensor Unit owned by the parent
Device. The reader uses the Adafruit DHT library, but `dht22DataPin` remains
`-1` until physical wiring is confirmed; no GPIO is invented. The default
sampling interval is 2000 ms, matching the DHT22’s practical read cadence.
Invalid, non-finite, or out-of-domain samples are discarded without rebooting
the ESP32. Valid samples are submitted through authenticated `POST
/sensor-reading` requests using the exact body that is HMAC-signed.

The server evaluates temperature, humidity, and an optional generic smoke value
against owner-configured, device-specific thresholds. In the Phase 10
sensor-only foundation, environmental danger did not unlock doors or trigger
emergency, servo, buzzer, or LCD behavior. The smoke sensor model, signal
GPIO, unit, and
calibration remain intentionally unassigned; no smoke library or fake reading
is used.

The DHT22 interval defines one combined Safety Sensor Unit cycle. Each cycle
attempts the DHT22 first and then attempts smoke without an independent loop.
If smoke is unavailable or invalid, the DHT22 reading is still submitted and
the smoke field is omitted. No stale or zero smoke value is substituted.

## Servo / door-lock foundation

Phase 13 adds a model-neutral `ServoDoorLock` abstraction and a
`ServoAreaMapper`. The prototype has three configurable physical servo slots;
each slot may represent a selected logical warehouse-area UUID during a
demonstration. The six logical doors therefore do not create six physical
servo objects.

Servo signal GPIO, lock angle, unlock angle, logical-area mapping, and bounded
unlock duration are configuration values. GPIOs and angles remain `-1` or
empty until the actual actuator wiring and mechanics are confirmed. No servo
library or hardware driver is assumed. The current unassigned driver cannot
move hardware and leaves the actuator unavailable/locked.

The access controller consumes the existing `AUTHORIZED`/`DENIED` response
classification. Only `AUTHORIZED` can request unlock; denied, malformed,
unauthenticated, network-failure, or unconfigured responses fail closed. A
configured actuator relocks using a non-blocking `millis()` deadline. The
Phase 13 foundation did not connect safety sensor `DANGER` to servo unlocking;
Phase 15 adds that connection through `EmergencyCoordinator`.

## Buzzer and LCD local feedback

Phase 14 adds model-neutral `BuzzerController` and `LcdController` abstractions.
The buzzer uses short, non-blocking success, denied, and error patterns. The
LCD displays only short generic messages such as `ACCESS GRANTED`,
`ACCESS DENIED`, `AUTH ERROR`, `NETWORK ERROR`, and `SAFETY: DANGER`.
Credentials, IDs, signatures, secrets, and internal errors are never shown.

Buzzer GPIO, buzzer type, LCD model, LCD interface, LCD pins, I2C address, and
display dimensions remain unassigned. The current unassigned drivers produce
no physical output. Repeated LCD text is cached and buzzer timing is advanced
from the main loop without long blocking delays. In the Phase 14 foundation,
safety `DANGER` was informational only; Phase 15 adds the emergency pattern
and coordinated unlock request.

## Emergency coordination foundation

Phase 15 adds `EmergencyCoordinator`, which consumes only a successful
authenticated sensor response containing the server-derived
`environmental_state: "DANGER"`. It requests emergency unlock on every
currently mapped physical servo slot through the existing mapping, activates
the existing emergency buzzer pattern, and shows `EMERGENCY ACTIVE` /
`UNLOCK REQUESTED` on the existing LCD abstraction.

Emergency mode is latched because no safe reset/re-arm authority exists yet.
Normal RFID/PIN results cannot relock emergency-mode doors while it is active.
Failures, unknown states, malformed responses, and invalid sensor data do not
activate emergency mode. Unassigned actuator hardware cannot physically move,
but it also cannot create a false unlock. This is a prototype demonstration
mechanism and is not a claim of life-safety or fire-code compliance.

## Heartbeat test status

The startup heartbeat check sends only when all TLS, time, and authentication
configuration is present.

## Not implemented in Phase 15

- physical smoke sensor model/wiring/calibration
- ESP32-CAM/OCR
- physical servo driver/library and wiring
- physical buzzer/LCD drivers and wiring
- safe emergency reset/re-arm authority
- GPIO assignments
- database/API business logic
- dashboard behavior

The approved database areas remain the source of truth. Firmware does not
hardcode area names, physical door counts, or permissions. The three prototype
servos remain reusable demonstration hardware, with their driver, GPIOs,
angles, and area assignments awaiting confirmation.
