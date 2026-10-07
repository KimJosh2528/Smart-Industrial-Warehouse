import os, hmac, hashlib, json, time, requests

url = os.environ["WG_FUNCTIONS_URL"].rstrip("/")
uid = os.environ["WG_DEVICE_UID"].strip()
sec = os.environ["WG_DEVICE_SECRET"].strip()
body = json.dumps({
    "area_id": os.environ["WG_STAFF_AREA"],
    "credential_type": "staff_face",
    "credential_hash": hashlib.sha256(b"kim").hexdigest(),
}, separators=(",", ":")).encode()

for name, key in (("text", sec.encode()), ("bytes", bytes.fromhex(sec))):
    ts = int(time.time())
    sig = hmac.new(key, str(ts).encode() + b"." + body, hashlib.sha256).hexdigest()
    r = requests.post(url + "/access-event", data=body, timeout=15, headers={
        "X-Device-UID": uid, "X-Timestamp": str(ts),
        "X-Signature": sig, "Content-Type": "application/json"})
    print(name, r.status_code, r.text)
    time.sleep(1.1)