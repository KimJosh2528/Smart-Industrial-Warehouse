# Camera server cloud bridge

The local `/verify?type=face|plate` endpoints remain unchanged for ESP Main.
When the following variables are set, each result is also sent to the signed
`camera-auth` Supabase Edge Function for database approval and access logging.
RFID events continue to use the ESP Main's existing signed `access-event` flow.

```powershell
$env:WG_FUNCTIONS_URL = "https://hxqevjiymnuiluszejpj.supabase.co/functions/v1"
$env:WG_DEVICE_UID = "camera-device-uid"
$env:WG_DEVICE_SECRET = "<device secret>"
$env:WG_CAMERA_STAFF_AREA_ID = "<staff-entrance-area-uuid>"
$env:WG_CAMERA_TRUCK_AREA_ID = "<truck-entrance-area-uuid>"
$env:WG_ANON_KEY = "<Supabase publishable/anon key>" # if the Edge gateway requires JWT
$env:CAMERA_TUNNEL_URL = "https://camera.example.com" # dashboard deployment env
```

Provision a separate camera device in Dashboard → Father Admin → Device Inventory.
Do not reuse the ESP Main device because each device has its own replay-protection
timestamp. Save the returned UID and secret in the environment above.

For the Bacongco demo warehouse, the configured entrance IDs are:

- Staff entrance: `c87694bf-ce8e-4034-ae88-46204852d544` or `5b128b3e-84d8-42eb-ac2e-aa02be8370b8`
- Truck entrances: `84d9ef5b-d29f-40dd-9dec-a277753286f3` (Export) and `3dd5ef72-35aa-45be-a1a3-702da9fe51a6` (Import)

Run the camera server on the same machine as the Cloudflare Tunnel. Point the
tunnel at `http://127.0.0.1:5001`; the Dashboard uses `CAMERA_TUNNEL_URL` as
the Security Channels link. Keep the tunnel protected with Cloudflare Access
or an equivalent policy before exposing `/live` publicly.

Face labels are not accepted merely because the local model recognizes them.
An administrator must create an active `camera_face_mappings` row (or call
`manage_camera_face_mapping`) for the approved staff/guard member. Truck plates
are checked against active registered `trucks` rows.
