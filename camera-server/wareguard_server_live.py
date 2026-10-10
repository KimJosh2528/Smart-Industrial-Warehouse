"""
WareGuard verification server WITH LIVE CAMERA VIEW

Run (from the ESP32_Face_Test folder):
    python wareguard_server_live.py [CAM_IP] [port]
    defaults: CAM_IP below, port 5001

Pages (on the laptop use http://127.0.0.1:5001/..., the ESP32 uses http://192.168.137.1:5001/...):
    /live                  live truck plate camera
    /verify?type=plate     OK <label> | DENY <text>  | ERR <reason>
    /ping                  pong

Keep /live open in one tab and call /verify from another tab (or the ESP32).
Do NOT also open the camera's own web page stream: the ESP32-CAM serves only
ONE stream client at a time, and this server is that client.

Needs:  pip install flask   (plus opencv, easyocr, requests)
"""
import base64, hashlib, hmac, json, os, re, sys, time, threading
import cv2
import numpy as np
import requests
import easyocr
from flask import Flask, request, Response, redirect

# ---------------------------------------------------------------- settings
VERSION = "NEW-FILE v14 (fast plate)"
CAM_IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.137.234"
PORT   = int(sys.argv[2]) if len(sys.argv) > 2 else 5001

# The development machine may have a dead local proxy configured. The ESP32-CAM
# is on the local hotspot, so camera HTTP and MJPEG traffic must bypass it.
_no_proxy_hosts = {"localhost", "127.0.0.1", "::1", CAM_IP}
os.environ["NO_PROXY"] = ",".join(_no_proxy_hosts)
os.environ["no_proxy"] = os.environ["NO_PROXY"]

# Optional cloud audit/authorization bridge. When these are not configured the
# existing local ESP HTTP verification flow behaves exactly as before.
CLOUD_FUNCTIONS_URL = os.environ.get("WG_FUNCTIONS_URL", "").rstrip("/")
CLOUD_DEVICE_UID = os.environ.get("WG_DEVICE_UID", "")
CLOUD_DEVICE_SECRET = os.environ.get("WG_DEVICE_SECRET", "")
CLOUD_AREA_ID = os.environ.get("WG_CAMERA_AREA_ID", "")
CLOUD_STAFF_AREA_ID = os.environ.get("WG_CAMERA_STAFF_AREA_ID", os.environ.get("WG_STAFF_AREA", CLOUD_AREA_ID))
CLOUD_TRUCK_AREA_ID = os.environ.get("WG_CAMERA_TRUCK_AREA_ID", os.environ.get("WG_TRUCK_AREA", CLOUD_AREA_ID))
CLOUD_ANON_KEY = os.environ.get("WG_ANON_KEY", "")
CLOUD_TIMEOUT = float(os.environ.get("WG_CLOUD_TIMEOUT", "8"))
_cloud_lock = threading.Lock()
_cloud_last_ts = 0

def cloud_config_status():
    return {
        "url": bool(CLOUD_FUNCTIONS_URL),
        "uid": bool(CLOUD_DEVICE_UID),
        "secret": bool(CLOUD_DEVICE_SECRET),
        "truck_area": bool(CLOUD_TRUCK_AREA_ID),
        "anon_key": bool(CLOUD_ANON_KEY),
    }

# Live view orientation (display only, does not change the checks).
# The camera picture is mirrored. True = flip it so text reads normally.
FACE_VIEW_FLIP = False    # FACE mode: picture as the camera sends it (not reversed)
PLATE_VIEW_FLIP = True    # TRUCK PLATE mode only: reversed so the plate text reads normally

FACE_FREEZE = True       # hold the captured picture ~5 s after a check (face AND plate)

FACES_DIR = "faces"
PLATES_FILE = "plates.txt"
FACE_THRESHOLD = 0.363     # a frame at/above this is a possible match
STRONG_SCORE = 0.60        # ONE frame this good is accepted immediately
FACE_FRAMES = 12           # (old setting, no longer used by the burst check)
FACE_NEED = 2              # otherwise this many frames must reach the threshold for the SAME name
FRAMESIZE_QVGA = 6         # real numbers are found at startup (detect_sizes):
FRAMESIZE_VGA = 9          # they differ between esp32-camera versions
ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -"
CONFUSE = str.maketrans("OIBSZQ", "018520")   # letters OCR mixes up with digits
FONT = cv2.FONT_HERSHEY_SIMPLEX

# ---- ACCURACY SETTINGS (freeze + burst + sharpest-frame voting) ----
BURST_FRAMES    = 10     # FACE: how many frames to grab after the press
BURST_GAP       = 0.08   # seconds between frames
BURST_KEEP      = 4      # FACE: only the sharpest N frames are recognised
FACE_MIN_SIZE   = 50     # face width in pixels (QVGA); smaller = too far away
FACE_UNMIRROR   = False  # set True if the "mirror test" in the log shows flipped is better
FACE_DEBUG_FLIP = True   # print the score normal vs flipped (for testing)

# ---- PLATE (fast mode: same capture speed as FACE, from the live stream) ----
PLATE_BURST     = 6      # frames grabbed from the stream (QVGA, fast)
PLATE_KEEP      = 2      # only the sharpest N frames are OCR'd (if PLATE_READ is True)
PLATE_NEED      = 1      # how many frames must match (2 = stricter)
PLATE_READ      = True  # False = capture + freeze only, NO OCR. True = also read the plate
PLATE_ENHANCE   = True   # CLAHE contrast before OCR (only used if PLATE_READ is True)
PLATE_QUALITY   = 10     # (old VGA mode, not used now)
CAM_NORMAL_QUALITY = 15  # (old VGA mode, not used now)

# ---------------------------------------------------------------- models
for m in ("yunet.onnx", "sface.onnx"):
    if not os.path.exists(m):
        raise SystemExit(f"{m} not found. Run this from the ESP32_Face_Test folder.")


def make_models():
    det = cv2.FaceDetectorYN.create("yunet.onnx", "", (320, 240), 0.6, 0.3, 5000)
    rec = cv2.FaceRecognizerSF.create("sface.onnx", "")
    return det, rec


def find_faces(det, img):
    if img is None:
        return []
    h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, faces = det.detect(img)
    return faces if faces is not None else []


def best_match(rec, img, face):
    feature = rec.feature(rec.alignCrop(img, face))
    name, score = "unknown", 0.0
    for n, kf in known_faces:
        s = rec.match(feature, kf, cv2.FaceRecognizerSF_FR_COSINE)
        if s > score:
            name, score = n, s
    return name, score


def learn_faces(det, rec):
    known = []
    for file in sorted(os.listdir(FACES_DIR)):
        if not file.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        img = cv2.imread(os.path.join(FACES_DIR, file))
        if img is None:
            print("Could not read:", file)
            continue
        if img.shape[1] > 800:
            scale = 800 / img.shape[1]
            img = cv2.resize(img, None, fx=scale, fy=scale)
        faces = find_faces(det, img)
        if len(faces) == 0:
            print("No face found in", file, "- skipped")
            continue
        best = max(faces, key=lambda f: f[2] * f[3])
        feature = rec.feature(rec.alignCrop(img, best))
        name = re.sub(r"[\d_\- ]+$", "", os.path.splitext(file)[0]) or file
        known.append((name, feature))
        print("Learned", name, "from", file)
    return known


def norm(t):
    t = re.sub(r"[^A-Z0-9]", "", t.upper())
    return t.translate(CONFUSE)


def load_plates():
    global authorized_raw
    d = {}
    authorized_raw = {}
    with open(PLATES_FILE, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                plate, _, label = line.strip().partition(",")
                key = norm(plate)
                d[key] = label or plate
                authorized_raw[key] = plate.strip()
    return d


verify_det, verify_rec = make_models()      # used by /verify
live_det, live_rec = make_models()          # used by the live thread (own copies: not thread-safe to share)
known_faces = learn_faces(verify_det, verify_rec)
if not known_faces:
    raise SystemExit("No faces learned. Check the photos in the faces folder.")
authorized = load_plates()
print("Authorized plates:", list(authorized.values()))
reader = easyocr.Reader(["en"], gpu=False)

# ---------------------------------------------------------------- camera
camera_http = requests.Session()
camera_http.trust_env = False


def cam_get(path, timeout=8):
    return camera_http.get(f"http://{CAM_IP}{path}", timeout=timeout)


def set_size(val):
    try:
        r = cam_get(f"/control?var=framesize&val={val}")
        print(f"[CAM] framesize={val} HTTP {r.status_code}")
        return r.status_code == 200
    except requests.RequestException as e:
        print("[CAM] could not set camera size:", e)
        return False


def set_quality(val):
    try:
        cam_get(f"/control?var=quality&val={val}")
    except requests.RequestException as e:
        print("[CAM] could not set quality:", e)


def capture(n_discard=0):
    """Grab a JPEG over port 80. The first pictures after a size change can be
    old, so n_discard pictures are thrown away and the last one is kept."""
    img = None
    for i in range(n_discard + 1):
        r = cam_get("/capture")
        n = len(r.content)
        img = None
        if r.status_code != 200 or n < 1000:
            print(f"[CAM] bad capture: HTTP {r.status_code}, {n} bytes")
        else:
            img = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                print(f"[CAM] could not decode the image ({n} bytes)")
        if i < n_discard:
            time.sleep(0.25)
    if img is not None:
        cv2.imwrite("last_capture.jpg", img)
    return img


def detect_sizes():
    """The framesize numbers sent to /control depend on the esp32-camera version:
    old library QVGA=5 (VGA=8), new library QVGA=6 (VGA=9) and 5 = 240x240.
    Try both and keep the one that really gives a 320x240 picture."""
    try:
        for val in (6, 5):
            set_size(val)
            time.sleep(0.5)
            img = capture(n_discard=3)
            if img is not None:
                print(f"[SIZE] framesize {val} -> {img.shape[1]}x{img.shape[0]}")
                if img.shape[1] == 320 and img.shape[0] == 240:
                    return (val, 10) if val == 6 else (val, val + 3)   # new lib: VGA=10, old lib: QVGA=5 / VGA=8
    except requests.RequestException as e:
        print("[SIZE] camera not reachable at startup:", e)
    print("[SIZE] WARNING: could not confirm 320x240, using QVGA=6 / VGA=9")
    return 6, 9


# ---------------------------------------------------------------- live view
live = {"raw": None, "t": 0.0, "jpg": None, "ok": False}
last_result = {"text": "", "t": 0.0}
last_detection = {"observed": "", "score": None}
plate_mode = {"on": False}      # False = FACE mode, True = TRUCK PLATE mode (set by the buttons or by a check)
selected_mode = {"value": "truck"}  # this demo has one camera mode: truck plate
flip = {"face": FACE_VIEW_FLIP, "plate": PLATE_VIEW_FLIP}   # can be toggled live with the Flip view button
hold = {"until": 0.0, "jpg": None}                          # frozen picture shown after a check
shot = {"img": None, "box": None, "label": ""}              # picture captured by the last check


def to_jpg(frame):
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return buf.tobytes()


def message_jpg(msg):
    frame = np.zeros((240, 320, 3), np.uint8)
    cv2.putText(frame, msg, (20, 120), FONT, 0.6, (255, 255, 255), 1)
    return to_jpg(cv2.resize(frame, None, fx=2, fy=2))


def annotate(frame):
    h, w = frame.shape[:2]

    if selected_mode["value"] in ("enroll", "draft"):
        label = "FACE ENROLL CAPTURE" if selected_mode["value"] == "enroll" else "FACE DRAFT CAPTURE"
        cv2.putText(frame, label, (6, 20), FONT, 0.6, (255, 255, 0), 1)
        return to_jpg(cv2.resize(frame, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))

    # TRUCK PLATE CHECK: plate picture only, no face boxes or names
    if plate_mode["on"]:
        if flip["plate"]:
            frame = cv2.flip(frame, 1)
        cv2.putText(frame, "TRUCK PLATE MODE", (6, 20), FONT, 0.6, (0, 255, 255), 1)
        return to_jpg(cv2.resize(frame, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))

    # FACE VIEW: detect on the original frame so the scores match the real check
    boxes = []
    for face in find_faces(live_det, frame):
        name, score = best_match(live_rec, frame, face)
        if score < FACE_THRESHOLD:
            name = "unknown"
        x, y, bw, bh = map(int, face[:4])
        boxes.append((name, score, x, y, bw, bh))

    if flip["face"]:
        frame = cv2.flip(frame, 1)
    cv2.putText(frame, "FACE MODE", (6, 16), FONT, 0.5, (255, 255, 0), 1)

    for name, score, x, y, bw, bh in boxes:
        if flip["face"]:
            x = w - x - bw          # move the box to the flipped position
        color = (0, 255, 0) if name != "unknown" else (0, 0, 255)
        cv2.rectangle(frame, (x, y), (x + bw, y + bh), color, 2)
        cv2.putText(frame, f"{name} {score:.2f}", (x, max(y - 8, 12)), FONT, 0.5, color, 1)


    return to_jpg(cv2.resize(frame, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))


def freeze(kind, result, secs=5):
    """Hold the captured picture on the live view for a few seconds, then go back to live."""
    img = shot["img"]
    if img is None:
        hold["until"] = 0.0           # nothing captured: just go back to live
        return
    f = img.copy()
    h, w = f.shape[:2]
    s = max(w / 320.0, 1.0) * 0.5
    if kind == "face":
        box = shot["box"]
        if flip["face"]:
            f = cv2.flip(f, 1)
        if box:
            x, y, bw, bh = box
            if flip["face"]:
                x = w - x - bw
            c = (0, 255, 0) if result.startswith("OK") else (0, 0, 255)
            cv2.rectangle(f, (x, y), (x + bw, y + bh), c, 2)
            cv2.putText(f, shot["label"], (x, max(y - 8, 12)), FONT, s, c, 1)
    elif flip["plate"]:
        f = cv2.flip(f, 1)
    if w < 500:
        f = cv2.resize(f, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    hold["jpg"] = to_jpg(f)
    hold["until"] = time.time() + secs


def stream_loop():
    live["jpg"] = message_jpg("Waiting for camera...")
    while True:
        cap = cv2.VideoCapture(f"http://{CAM_IP}:81/stream")
        if not cap.isOpened():
            live["ok"] = False
            if time.time() >= hold["until"]:
                live["jpg"] = message_jpg("NO SIGNAL - check CAM_IP / close other stream tabs")
            print("[LIVE] cannot open the stream - check CAM_IP and close other stream tabs")
            time.sleep(3)
            continue
        print("[LIVE] stream connected")
        while True:
            ok, img = cap.read()
            if not ok:
                break
            live["raw"], live["t"], live["ok"] = img, time.time(), True
            if time.time() < hold["until"]:       # showing the captured picture
                live["jpg"] = hold["jpg"]
                continue
            try:
                live["jpg"] = annotate(img.copy())
            except Exception as e:
                print("[LIVE] annotate error:", repr(e))
        live["ok"] = False
        if time.time() >= hold["until"]:
            live["jpg"] = message_jpg("NO SIGNAL")
        cap.release()
        time.sleep(1)


# ---------------------------------------------------------------- accuracy helpers
def sharpness(img, box=None):
    """Laplacian variance: higher = sharper. With a box, only that region (the face)."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if box is not None:
        x, y, w, h = box
        x, y = max(x, 0), max(y, 0)
        g = g[y:y + h, x:x + w]
        if g.size == 0:
            return 0.0
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def burst_from_stream(n, gap):
    """Grab n DIFFERENT frames from the live stream (no duplicates)."""
    frames, last_t = [], 0.0
    t_end = time.time() + n * gap * 4 + 1.5
    while len(frames) < n and time.time() < t_end:
        f, t = live["raw"], live["t"]
        if f is not None and t != last_t and time.time() - t < 1.5:
            frames.append(f.copy())
            last_t = t
        time.sleep(gap)
    return frames


def show_reading(img, msg="", plate=False):
    """FREEZE: show the captured picture right away (no text on top)."""
    if not FACE_FREEZE:
        return
    f = img.copy()
    if flip["plate" if plate else "face"]:
        f = cv2.flip(f, 1)
    if f.shape[1] < 500:
        f = cv2.resize(f, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    hold["jpg"] = to_jpg(f)
    hold["until"] = time.time() + 15      # freeze() in /verify overrides this after the result

def analyse(img, unmirror):
    """Find the biggest face. Return (quality, work_img, face, box) or None."""
    work = cv2.flip(img, 1) if unmirror else img
    faces = find_faces(verify_det, work)
    if len(faces) == 0:
        return None
    face = max(faces, key=lambda f: f[2] * f[3])
    box = tuple(map(int, face[:4]))
    q = sharpness(work, box) * float(face[14])      # sharpness x detector confidence
    return q, work, face, box


def plate_ocr(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if PLATE_ENHANCE:
        gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    found = reader.readtext(gray, allowlist=ALLOWED)
    return [(t.strip(), c) for _, t, c in found if c > 0.4 and len(t.strip()) >= 3]


# ---------------------------------------------------------------- checks
def verify_face(purpose="verify"):
    action = "enrollment capture" if purpose == "enroll" else "verification"
    print(f"\n==============================\n[FACE] Starting {action} (freeze + burst)")
    frames = burst_from_stream(BURST_FRAMES, BURST_GAP)
    if len(frames) < 3:
        print("[FACE] stream thin, adding /capture frames")
        for _ in range(3):
            f = capture()
            if f is not None:
                frames.append(f)
    if not frames:
        return "ERR no_image"

    show_reading(frames[-1])                       # FREEZE first, then read
    print(f"[FACE] captured {len(frames)} frames")

    cands = []                                     # (quality, orig, work, face, box)
    for f in frames:
        a = analyse(f, FACE_UNMIRROR)
        if a is not None:
            cands.append((a[0], f, a[1], a[2], a[3]))
    if not cands:
        shot.update(img=frames[-1], box=None, label="no face")
        print("[FACE] no face in any frame")
        return "ERR no_face"

    big = [c for c in cands if c[4][2] >= FACE_MIN_SIZE]
    if big:
        cands = big
    else:
        print(f"[FACE] all faces smaller than {FACE_MIN_SIZE}px - too far? using them anyway")
    cands.sort(key=lambda c: c[0], reverse=True)
    cands = cands[:BURST_KEEP]

    hits = {}
    best_name, best_score = "unknown", 0.0
    best_img, best_box = None, None
    strong_name = None
    for i, (q, orig, work, face, box) in enumerate(cands):
        name, score = best_match(verify_rec, work, face)
        print(f"[FACE] sharp frame {i + 1}/{len(cands)} (q={q:.0f}, face {box[2]}px): {name} {score:.3f}")
        if score > best_score:
            best_name, best_score, best_img = name, score, orig
            x, y, bw, bh = box
            if FACE_UNMIRROR:                      # map the box back to the original picture
                x = orig.shape[1] - x - bw
            best_box = (x, y, bw, bh)
        if score >= STRONG_SCORE and strong_name is None:
            strong_name = name
        if score >= FACE_THRESHOLD:
            hits[name] = hits.get(name, 0) + 1

    if FACE_DEBUG_FLIP:                            # sharpest frame: current vs flipped
        q, orig, work, face, box = cands[0]
        a2 = analyse(orig, not FACE_UNMIRROR)
        if a2 is not None:
            n2, s2 = best_match(verify_rec, a2[1], a2[2])
            n1, s1 = best_match(verify_rec, work, face)
            print(f"[FACE] mirror test: current {n1} {s1:.3f} | flipped {n2} {s2:.3f}")

    consistent = [n for n, h in hits.items() if h >= FACE_NEED]
    accepted = None
    if strong_name:
        accepted = strong_name
    elif len(consistent) == 1:
        accepted = consistent[0]
    # if two different names passed, do not accept
    others = [n for n in hits if n != accepted and hits[n] >= FACE_NEED]
    if accepted and others:
        print(f"[FACE] ambiguous: {accepted} vs {others} -> deny")
        accepted = None

    last_detection.update(observed=accepted or best_name, score=best_score)
    shot.update(img=best_img if best_img is not None else frames[-1], box=best_box,
                label=f"{best_name} {best_score:.2f}")
    print(f"[FACE] FINAL: {accepted or 'unknown'}")
    print(f"[FACE] SCORE: {best_score:.3f}  (best was {best_name}; needs {FACE_THRESHOLD})")
    print("==============================")
    if accepted:
        return f"OK {accepted}"
    return "DENY unknown"


def verify_plate():
    # Pick up truck create/assignment changes without restarting this server.
    global authorized
    authorized = load_plates()
    print("\n==============================\n[PLATE] fast capture from stream")
    frames = burst_from_stream(PLATE_BURST, BURST_GAP)
    if len(frames) < 2:
        print("[PLATE] stream thin, adding /capture frames")
        for _ in range(2):
            f = capture()
            if f is not None:
                frames.append(f)
    if not frames:
        return "ERR no_image"

    frames.sort(key=sharpness, reverse=True)       # sharpest first
    best = frames[0]
    shot.update(img=best, box=None, label="")
    show_reading(best, "CAPTURED", plate=True)     # FREEZE right away, same as face mode
    cv2.imwrite("last_plate.jpg", cv2.flip(best, 1))
    print(f"[PLATE] captured {len(frames)} frames, best {best.shape[1]}x{best.shape[0]}")

    if not PLATE_READ:
        print("[PLATE] reading is OFF (PLATE_READ = False)")
        return "ERR no_reading"

    votes, all_good = {}, []
    for i, img in enumerate([cv2.flip(f, 1) for f in frames[:PLATE_KEEP]]):
        good = plate_ocr(img)
        print(f"[PLATE] frame {i + 1}: ", [(t, round(float(c), 2)) for t, c in good])
        all_good += good
        keys = [norm(t) for t, _ in good]
        keys.append("".join(keys))                 # a plate that OCR split into two boxes
        for k in keys:
            if k in authorized:
                votes[authorized[k]] = votes.get(authorized[k], 0) + 1
                break
        for label, v in votes.items():
            if v >= PLATE_NEED:
                # The local matcher folds ambiguous OCR characters (for
                # example Q -> 0), but the cloud bridge must receive the
                # registered plate identity from plates.txt.
                last_detection.update(
                    observed=authorized_raw.get(k, k),
                    score=max((c for t, c in all_good if norm(t) == k), default=None),
                )
                print(f"[PLATE] matched {label} ({v} frame)")
                return f"OK {label}"

    if not all_good:
        return "ERR no_text"
    best_text, best_score = max(all_good, key=lambda x: x[1])
    last_detection.update(observed=best_text, score=best_score)
    return f"DENY {best_text}"


def capture_face_only():
    """Capture a face image without treating it as an authentication attempt."""
    print("\n==============================\n[FACE] Starting capture-only burst")
    frames = burst_from_stream(BURST_FRAMES, BURST_GAP)
    if len(frames) < 3:
        for _ in range(3):
            frame = capture()
            if frame is not None:
                frames.append(frame)
    if not frames:
        return "ERR no_image", None, None

    candidates = []
    for frame in frames:
        analysed = analyse(frame, FACE_UNMIRROR)
        if analysed is not None:
            candidates.append((analysed[0], frame, analysed[1], analysed[2], analysed[3]))
    if not candidates:
        shot.update(img=frames[-1], box=None, label="no face")
        show_reading(frames[-1])
        return "ERR no_face", None, None

    best = max(candidates, key=lambda item: item[0])
    _, original, work, face, box = best
    recognized_label, recognized_score = best_match(verify_rec, work, face)
    label = recognized_label if recognized_score >= FACE_THRESHOLD else None
    shot.update(img=original, box=box, label=label or "captured")
    show_reading(original)
    encoded = cv2.imencode(".jpg", original, [cv2.IMWRITE_JPEG_QUALITY, 90])[1]
    image_base64 = base64.b64encode(encoded.tobytes()).decode("ascii")
    print(f"[FACE] captured only; recognized label: {label or 'none'}")
    return "OK captured", image_base64, label


def send_cloud_auth(kind, result):
    """Forward the local recognition result for server-side approval and logging."""
    area_id = CLOUD_STAFF_AREA_ID if kind == "face" else CLOUD_TRUCK_AREA_ID
    if not (CLOUD_FUNCTIONS_URL and CLOUD_DEVICE_UID and CLOUD_DEVICE_SECRET and area_id):
        missing = [name for name, present in (
            ("WG_FUNCTIONS_URL", bool(CLOUD_FUNCTIONS_URL)),
            ("WG_DEVICE_UID", bool(CLOUD_DEVICE_UID)),
            ("WG_DEVICE_SECRET", bool(CLOUD_DEVICE_SECRET)),
            ("WG_CAMERA_TRUCK_AREA_ID", bool(area_id)),
        ) if not present]
        print(f"[CLOUD] skipped; missing: {', '.join(missing)}")
        return None
    observed = last_detection.get("observed", "").strip()
    if not observed:
        return None
    method = "staff_face" if kind == "face" else "truck_plate"
    body = {"area_id": area_id, "method": method, "observed": observed}
    if isinstance(last_detection.get("score"), (int, float)):
        body["score"] = float(last_detection["score"])
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    global _cloud_last_ts
    with _cloud_lock:
        timestamp = max(int(time.time()), _cloud_last_ts + 1)
        _cloud_last_ts = timestamp
        signature = hmac.new(
            CLOUD_DEVICE_SECRET.encode("utf-8"),
            str(timestamp).encode("ascii") + b"." + raw,
            hashlib.sha256,
        ).hexdigest()
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Device-UID": CLOUD_DEVICE_UID,
            "X-Timestamp": str(timestamp),
            "X-Signature": signature,
        }
        if CLOUD_ANON_KEY:
            headers["apikey"] = CLOUD_ANON_KEY
            headers["Authorization"] = f"Bearer {CLOUD_ANON_KEY}"
        response = requests.post(
            f"{CLOUD_FUNCTIONS_URL}/camera-auth",
            data=raw,
            headers=headers,
            timeout=CLOUD_TIMEOUT,
        )
        try:
            payload = response.json()
        except ValueError:
            payload = {"status": "error", "message": "invalid_cloud_response"}
        print(f"[CLOUD] {method} HTTP {response.status_code}: {payload}")
        return payload
    except requests.RequestException as error:
        print("[CLOUD] unavailable:", error)
        return {"status": "error", "message": "cloud_unavailable"}


# ---------------------------------------------------------------- web server
app = Flask(__name__)
busy = threading.Lock()


@app.after_request
def allow_dashboard_camera_control(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def text(s):
    return Response(s + "\n", mimetype="text/plain")


@app.route("/ping")
def ping():
    return text("pong")


@app.route("/")
def index():
    return redirect("/live")


@app.route("/live")
def live_page():
    html = """<html><body style="margin:0;background:#111;color:#eee;font-family:sans-serif">
 <div style="padding:10px 10px 0 10px">
  <button onclick="mode('truck')" style="font-size:18px;padding:8px 16px;background:#642;color:#fff">TRUCK AUTH</button>
 </div>
<div style="padding:10px">
  <span id="out" style="font-size:28px;font-weight:bold;margin-left:14px;vertical-align:middle;color:#9de">READY — press GPIO35</span>
</div>
<img src="/live.mjpg" style="width:auto;max-width:100%;max-height:78vh;display:block">
  <p style="padding:0 10px;font-size:14px">Running: @@V@@ - truck plate authentication only. RFID is handled by the staff gate.</p>
<p style="padding:0 10px">Plate authorization opens the truck gate; unrecognized plates remain closed.</p>
<script>
async function mode(m) {
  try { await fetch('/mode?m=truck'); } catch (e) {}
  document.getElementById('out').textContent = 'READY — press GPIO35';
  document.getElementById('out').style.color = '#9de';
}
function fmt(r) {
  if (r.startsWith('OK')) return ['AUTHORIZED ' + r.slice(3).trim(), '#3ddc84'];
  if (r.startsWith('DENY')) return ['UNAUTHORIZED ' + r.slice(5).trim(), '#ff5252'];
  return [r, '#ffd54a'];
}
async function poll() {
  const out = document.getElementById('out');
  try {
    const d = await (await fetch('/last')).json();
    if (d.busy) {
      out.textContent = 'CHECKING PLATE — ESP BUTTON RECEIVED...';
      out.style.color = '#ffd54a';
    } else if (d.text) {
      const f = fmt(d.text);
      out.textContent = f[0];
      out.style.color = f[1];
    } else {
      out.textContent = 'READY — press GPIO35';
      out.style.color = '#9de';
    }
  } catch (e) {}
}
async function run(t) {
  const btn = document.getElementById('runbtn');
  btn.disabled = true;
  try {
    await fetch('/verify?type=plate', {headers: {'X-WareGuard-Trigger': 'esp-button'}});
  } catch (e) {}
  btn.disabled = false;
  poll();
}
mode('truck');
poll();
setInterval(poll, 300);
</script>
</body></html>"""
    return Response(html.replace("@@V@@", VERSION), mimetype="text/html")


@app.route("/live.mjpg")
def live_mjpg():
    def gen():
        last = None
        while True:
            jpg = live["jpg"]
            if jpg is not None and jpg is not last:
                last = jpg
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
            time.sleep(0.03)
    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/mode")
def set_mode():
    m = request.args.get("m", "")
    if m == "flip":
        k = "plate" if plate_mode["on"] else "face"
        flip[k] = not flip[k]
    elif m == "truck":
        selected_mode["value"] = "truck"
        plate_mode["on"] = True
    elif m in ("staff", "enroll", "draft"):
        return text("mode truck (only truck plate mode is enabled)")
    return text("mode " + selected_mode["value"])


@app.route("/getmode")
def get_mode():
    return text("TRUCK")


@app.route("/getui_mode")
def get_ui_mode():
    return text(selected_mode["value"])


@app.route("/last")
def last_json():
    return Response(json.dumps({"busy": busy.locked(), "text": last_result["text"],
                                "kind": last_result.get("kind", ""), "t": last_result["t"],
                                "cloud": last_result.get("cloud")}),
                    mimetype="application/json")


def run_check(kind, purpose="verify"):
    """Run a local camera check. Enrollment never sends a cloud auth event."""
    if not busy.acquire(blocking=False):
        return "ERR busy"
    t0 = time.time()
    last_detection.update(observed="", score=None)

    try:
        result = verify_face(purpose) if kind == "face" else verify_plate()
    except requests.RequestException as e:
        print("[SERVER] camera error:", e)
        result = "ERR cam_offline"
    except Exception as e:
        print("[SERVER] server error:", repr(e))
        result = "ERR server"
    finally:
        busy.release()

    cloud = None if purpose == "enroll" else send_cloud_auth(kind, result)
    display_result = result
    # The cloud authorization service is authoritative when configured because
    # it checks the live registered-truck table. Keep the local OCR result as
    # the fallback when the bridge is unavailable.
    if kind == "plate" and isinstance(cloud, dict):
        cloud_status = cloud.get("status")
        observed = str(last_detection.get("observed") or "").strip()
        if cloud_status == "authorized":
            display_result = f"OK {observed}" if observed else "OK authorized"
        elif cloud_status == "denied":
            display_result = f"DENY {observed}" if observed else "DENY unauthorized"
    last_result["cloud"] = cloud
    last_result.update(text=display_result, t=time.time(), kind=kind)
    if FACE_FREEZE:
        try:
            freeze(kind, display_result)
        except Exception as e:
            print("[SERVER] freeze error:", repr(e))
            hold["until"] = 0.0
    print(f"[{kind}/{purpose}] {result}  ({time.time() - t0:.1f}s)")
    return result


@app.route("/enroll")
def enroll():
    """Capture a face for enrollment without authenticating it."""
    kind = request.args.get("type", "").strip().lower()
    if kind != "face":
        return text("ERR bad_type")
    return capture_only_response("enroll")


@app.route("/draft")
def draft():
    """Capture a pending applicant face without authenticating it."""
    kind = request.args.get("type", "").strip().lower()
    if kind != "face":
        return text("ERR bad_type")
    return capture_only_response("draft")


def capture_only_response(purpose):
    if not busy.acquire(blocking=False):
        return Response(json.dumps({"status": "error", "message": "busy"}), mimetype="application/json")
    try:
        result, image_base64, label = capture_face_only()
    finally:
        busy.release()
    last_result.update(text=result, t=time.time(), kind=purpose, cloud=None)
    return Response(json.dumps({"status": "success" if result.startswith("OK") else "error", "message": result, "image_base64": image_base64, "face_label": label}), mimetype="application/json")


@app.route("/verify")
def verify():
    if request.headers.get("X-WareGuard-Trigger") != "esp-button":
        return text("ERR hardware_trigger_required")
    kind = request.args.get("type", "").strip().lower()
    if selected_mode["value"] != "truck":
        return text("ERR truck_plate_mode_required")
    if kind == "auto":
        kind = "plate"
    if kind != "plate":
        return text("ERR bad_type")
    return text(run_check(kind))


if __name__ == "__main__":
    FRAMESIZE_QVGA, FRAMESIZE_VGA = detect_sizes()
    print(f"[SIZE] using QVGA={FRAMESIZE_QVGA}, VGA={FRAMESIZE_VGA}")
    threading.Thread(target=stream_loop, daemon=True).start()
    print(f"\nWAREGUARD VERIFICATION SERVER  {VERSION}  (camera {CAM_IP}, port {PORT})")
    print(f"  Live view : http://127.0.0.1:{PORT}/live")
    print(f"  Truck auth: ESP button -> /verify?type=plate\n")
    print(f"  Cloud config: {cloud_config_status()}")
    app.run(host="0.0.0.0", port=PORT, threaded=True)
