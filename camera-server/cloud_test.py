"""
WareGuard cloud test client (Day 1)
Sends SIGNED requests to the Supabase Edge Functions, the same way the device would.

Set these in PowerShell first. The device secret stays on your laptop, never paste it in chat.
  $env:WG_FUNCTIONS_URL = "https://hxqevjiymnuiluszejpj.supabase.co/functions/v1"
  $env:WG_DEVICE_UID    = "esp32cam-truck-plate-01"
  $env:WG_DEVICE_SECRET = "<secret returned by Device Inventory provisioning>"
  $env:WG_STAFF_AREA    = "95834a46-908a-40cf-b0d1-28f67c3e9d1d"
  $env:WG_TRUCK_AREA    = "84d9ef5b-d29f-40dd-9dec-a277753286f3"
  optional: $env:WG_ANON_KEY = "<anon key>"     # only if the gateway answers "Invalid JWT"

Usage:
  python cloud_test.py sensor 24.5 52 120      temperature_c  humidity_pct  smoke_value (0-1023 scale)
  python cloud_test.py staff_rfid 8bd6f1ca     lowercase hex UID, no spaces or colons
  python cloud_test.py staff_face kim          the name the face server returns
  python cloud_test.py truck_pin truck404      plate text used as the truck credential (workaround)
  python cloud_test.py truck_rfid 04ab127f

Needs: pip install requests
"""
import hashlib
import hmac
import json
import os
import sys
import threading
import time

import requests

URL = os.environ.get("WG_FUNCTIONS_URL", "").rstrip("/")
UID = os.environ.get("WG_DEVICE_UID", "")
SECRET = os.environ.get("WG_DEVICE_SECRET", "")
STAFF_AREA = os.environ.get("WG_STAFF_AREA", "")
TRUCK_AREA = os.environ.get("WG_TRUCK_AREA", "")
ANON_KEY = os.environ.get("WG_ANON_KEY", "")

_lock = threading.Lock()
_last_ts = 0


def credential_hash(raw):
    """Same as the database: lower(btrim(value)) -> UTF-8 -> SHA-256 -> lowercase hex."""
    return hashlib.sha256(raw.strip().lower().encode("utf-8")).hexdigest()


def post(endpoint, body):
    """Signed POST. The server rejects a timestamp that is not newer than the last one it saw,
    so requests are sent one at a time with strictly increasing timestamps."""
    global _last_ts
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    with _lock:
        ts = max(int(time.time()), _last_ts + 1)
        _last_ts = ts
        sig = hmac.new(SECRET.encode("utf-8"), str(ts).encode("utf-8") + b"." + raw,
               hashlib.sha256).hexdigest()
        headers = {
            "X-Device-UID": UID,
            "X-Timestamp": str(ts),
            "X-Signature": sig,
            "Content-Type": "application/json",
        }
        if ANON_KEY:
            headers["apikey"] = ANON_KEY
            headers["Authorization"] = "Bearer " + ANON_KEY
        r = requests.post(f"{URL}/{endpoint}", data=raw, headers=headers, timeout=15)
    return r.status_code, r.text


def send_sensor(temp, hum, smoke=None):
    body = {"temperature_c": temp, "humidity_pct": hum}
    if smoke is not None:
        body["smoke_value"] = smoke
    return post("sensor-reading", body)


def send_access(credential_type, value):
    area = TRUCK_AREA if credential_type.startswith("truck") else STAFF_AREA
    return post("access-event", {
        "area_id": area,
        "credential_type": credential_type,
        "credential_hash": credential_hash(value),
    })


def main():
    missing = [n for n, v in (("WG_FUNCTIONS_URL", URL), ("WG_DEVICE_UID", UID),
                              ("WG_DEVICE_SECRET", SECRET)) if not v]
    if missing:
        raise SystemExit("Set these first: " + ", ".join(missing))
    if "project-ref" in URL.lower() or "<" in URL:
        raise SystemExit("WG_FUNCTIONS_URL still has the placeholder in it. Use your real project URL "
                         "(Supabase > Project Settings > API > Project URL) + /functions/v1")
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)

    cmd = sys.argv[1]
    try:
        run(cmd)
    except requests.exceptions.ConnectionError:
        raise SystemExit(f"Could not reach {URL} - check WG_FUNCTIONS_URL and your internet connection")


def run(cmd):
    if cmd == "sensor":
        smoke = float(sys.argv[4]) if len(sys.argv) > 4 else None
        code, text = send_sensor(float(sys.argv[2]), float(sys.argv[3]), smoke)
    elif cmd in ("staff_rfid", "staff_face", "staff_pin", "truck_rfid", "truck_pin"):
        area = TRUCK_AREA if cmd.startswith("truck") else STAFF_AREA
        if not area:
            raise SystemExit("Set WG_STAFF_AREA / WG_TRUCK_AREA first")
        code, text = send_access(cmd, sys.argv[2])
    else:
        raise SystemExit(__doc__)

    print("HTTP", code)
    print(text)


if __name__ == "__main__":
    main()
