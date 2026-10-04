# Final-project device provisioning

The old PHP command belongs only to the reference project and must not be used
for final-project devices.

Use the TypeScript admin tool from the final-project repository:

~~~powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<server-only service-role key>'
$env:DEVICE_SECRET_KEY_HEX = '<server-only 64-hex Secretbox key>'

deno run --allow-env --allow-net tools/provision-device.ts --warehouse-id <warehouse-uuid> "Pool Device 4"
~~~

This is an operator-side command, not React browser code. The service-role key
and encryption key must never be placed in the dashboard or firmware.

The tool:

- requires an existing final-project warehouse;
- generates a cryptographically random unique device UID;
- generates a cryptographically random per-device HMAC secret;
- encrypts the device secret with DEVICE_SECRET_KEY_HEX using libsodium Secretbox;
- inserts only the encrypted secret into public.devices through the server-side REST API;
- retries generated UID collisions;
- rejects a collision for an explicitly supplied --uid;
- displays the secret once and never writes it to a file or log;
- does not create owners, warehouses, registration keys, or dashboard accounts.

Optional flags:

~~~powershell
--device-type controller|camera|sensor_module|access_module|other
--uid <pre-approved-unique-uid>
~~~

The device secret must be loaded only into the device's private ignored firmware
configuration. Do not place it in Git, browser code, API responses, or logs.

