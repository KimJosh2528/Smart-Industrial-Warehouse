"""
WareGuard verification server

ESP32 calls:

    http://192.168.0.111:5001/verify?type=face
    http://192.168.0.111:5001/verify?type=plate

Response:

    OK <label>
    DENY <label>
    ERR <reason>
"""

import os
import re
import time
import threading

import cv2
import numpy as np
import requests
import easyocr

from flask import Flask, request, Response


# ============================================================
# SETTINGS
# ============================================================

CAM_IP = "192.168.137.234"

FACES_DIR = "faces"
PLATES_FILE = "plates.txt"

FACE_THRESHOLD = 0.363

# Number of attempts during face verification
FACE_FRAMES = 12

# Camera framesize values
FRAMESIZE_QVGA = 5
FRAMESIZE_VGA = 8

# ============================================================
# OCR
# ============================================================

ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -"

CONFUSE = str.maketrans(
    "OIBSZQ",
    "018520"
)


# ============================================================
# CHECK MODEL FILES
# ============================================================

for model in ("yunet.onnx", "sface.onnx"):

    if not os.path.exists(model):

        raise SystemExit(
            f"{model} not found. "
            f"Run face_test.py once or put {model} "
            f"next to this script."
        )


# ============================================================
# LOAD FACE MODELS
# ============================================================

detector = cv2.FaceDetectorYN.create(
    "yunet.onnx",
    "",
    (320, 240),
    0.6,
    0.3,
    5000
)

recognizer = cv2.FaceRecognizerSF.create(
    "sface.onnx",
    ""
)


# ============================================================
# FACE DETECTION
# ============================================================

def find_faces(img):

    if img is None:
        return []

    h, w = img.shape[:2]

    detector.setInputSize((w, h))

    _, faces = detector.detect(img)

    if faces is None:
        return []

    return faces


# ============================================================
# LEARN AUTHORIZED FACES
# ============================================================

def learn_faces():

    known = []

    if not os.path.exists(FACES_DIR):

        raise SystemExit(
            f"Faces folder not found: {FACES_DIR}"
        )

    for file in sorted(os.listdir(FACES_DIR)):

        if not file.lower().endswith(
            (".jpg", ".jpeg", ".png")
        ):
            continue

        path = os.path.join(FACES_DIR, file)

        img = cv2.imread(path)

        if img is None:

            print("Could not read:", file)
            continue

        # Resize very large reference images
        if img.shape[1] > 800:

            scale = 800 / img.shape[1]

            img = cv2.resize(
                img,
                None,
                fx=scale,
                fy=scale
            )

        faces = find_faces(img)

        if len(faces) == 0:

            print(
                "No face found in",
                file,
                "- skipped"
            )

            continue

        # Largest face
        best = max(
            faces,
            key=lambda f: f[2] * f[3]
        )

        feature = recognizer.feature(
            recognizer.alignCrop(
                img,
                best
            )
        )

        # Remove numbers, underscores, hyphens and spaces
        name = re.sub(
            r"[\d_\- ]+$",
            "",
            os.path.splitext(file)[0]
        )

        if not name:
            name = file

        known.append(
            (name, feature)
        )

        print(
            f"Learned {name} from {file}"
        )

    return known


# ============================================================
# PLATE NORMALIZATION
# ============================================================

def norm(t):

    t = re.sub(
        r"[^A-Z0-9]",
        "",
        t.upper()
    )

    return t.translate(CONFUSE)


# ============================================================
# LOAD AUTHORIZED PLATES
# ============================================================

def load_plates():

    d = {}

    if not os.path.exists(PLATES_FILE):

        raise SystemExit(
            f"{PLATES_FILE} not found."
        )

    with open(
        PLATES_FILE,
        encoding="utf-8"
    ) as f:

        for line in f:

            if line.strip():

                plate, _, label = (
                    line.strip().partition(",")
                )

                d[norm(plate)] = (
                    label or plate
                )

    return d


# ============================================================
# LOAD EVERYTHING
# ============================================================

known_faces = learn_faces()

if not known_faces:

    raise SystemExit(
        "No faces learned. "
        "Check the photos in the faces folder."
    )

authorized = load_plates()

print(
    "Authorized plates:",
    list(authorized.values())
)


# ============================================================
# OCR
# ============================================================

reader = easyocr.Reader(
    ["en"],
    gpu=False
)


# ============================================================
# CAMERA FUNCTIONS
# ============================================================

def cam_get(path, timeout=8):

    return requests.get(
        f"http://{CAM_IP}{path}",
        timeout=timeout
    )


def set_size(val):

    try:

        r = cam_get(
            f"/control?var=framesize&val={val}"
        )

        print(
            f"[CAM] Set framesize={val} "
            f"HTTP={r.status_code}"
        )

        return r.status_code == 200

    except requests.RequestException as e:

        print(
            "[CAM] Could not set camera size:",
            e
        )

        return False


def capture(n_discard=0):

    """
    Capture a JPEG from the ESP32-CAM.

    Rejects invalid/non-JPEG responses.

    Saves the latest valid frame as
    last_face.jpg.
    """

    img = None

    for i in range(n_discard + 1):

        try:

            r = cam_get(
                "/capture",
                timeout=8
            )

            content_type = r.headers.get(
                "Content-Type",
                ""
            )

            data_len = len(r.content)

            print(
                f"[CAM] HTTP={r.status_code} "
                f"Content-Type={content_type} "
                f"Bytes={data_len}"
            )

            if r.status_code != 200:

                print(
                    "[CAM] Bad HTTP response"
                )

                img = None

            elif data_len < 1000:

                print(
                    "[CAM] Frame too small - discarded"
                )

                img = None

            else:

                img = cv2.imdecode(
                    np.frombuffer(
                        r.content,
                        np.uint8
                    ),
                    cv2.IMREAD_COLOR
                )

                if img is not None:

                    print(
                        f"[CAM] Image decoded: "
                        f"{img.shape}"
                    )

                else:

                    print(
                        "[CAM] ERROR: "
                        "OpenCV could not decode image"
                    )

        except requests.RequestException as e:

            print(
                "[CAM] Capture request failed:",
                e
            )

            img = None

        if i < n_discard:

            time.sleep(0.25)

    if img is not None:

        cv2.imwrite(
            "last_face.jpg",
            img
        )

        print(
            "[CAM] Saved last_face.jpg"
        )

    return img


# ============================================================
# CAMERA HEALTH CHECK
# ============================================================

def camera_ping():

    try:

        r = cam_get(
            "/capture",
            timeout=5
        )

        if r.status_code != 200:
            return False

        if len(r.content) < 1000:
            return False

        test = cv2.imdecode(
            np.frombuffer(
                r.content,
                np.uint8
            ),
            cv2.IMREAD_COLOR
        )

        if test is None:
            return False

        print(
            f"[CAM] Health check OK: "
            f"{test.shape}, {len(r.content)} bytes"
        )

        return True

    except Exception as e:

        print(
            "[CAM] Health check failed:",
            e
        )

        return False


# ============================================================
# FACE VERIFICATION
# ============================================================

def verify_face():

    print()
    print("==============================")
    print("[FACE] Starting verification")
    print("==============================")

    # IMPORTANT:
    # ESP32-CAM is already initialized at QVGA.
    #
    # Do NOT repeatedly switch its framesize before
    # every face verification.
    #
    # This avoids unnecessary camera sensor changes.

    print("[FACE] Using camera's current QVGA mode")

    # Give camera a moment before first capture.
    time.sleep(0.3)

    best_name = "unknown"
    best_score = 0.0

    seen_face = False
    good_frames = 0

    for i in range(FACE_FRAMES):

        print(
            f"[FACE] Capturing frame "
            f"{i + 1}/{FACE_FRAMES}"
        )

        img = capture()

        if img is None:

            print(
                f"[FACE] Frame {i + 1}: "
                "IMAGE ERROR"
            )

            time.sleep(0.2)
            continue

        faces = find_faces(img)

        print(
            f"[FACE] Frame {i + 1}: "
            f"{len(faces)} face(s) detected"
        )

        if len(faces) == 0:

            print(
                f"[FACE] Frame {i + 1}: NO FACE"
            )

            time.sleep(0.2)
            continue

        seen_face = True
        good_frames += 1

        # Select largest detected face
        face = max(
            faces,
            key=lambda f: f[2] * f[3]
        )

        feature = recognizer.feature(
            recognizer.alignCrop(
                img,
                face
            )
        )

        frame_best_name = "unknown"
        frame_best_score = 0.0

        # Compare against every authorized face
        for name, known_feature in known_faces:

            score = recognizer.match(
                feature,
                known_feature,
                cv2.FaceRecognizerSF_FR_COSINE
            )

            print(
                f"[FACE] {name}: "
                f"{score:.3f}"
            )

            if score > frame_best_score:

                frame_best_name = name
                frame_best_score = score

            if score > best_score:

                best_name = name
                best_score = score

        print(
            f"[FACE] Frame result: "
            f"{frame_best_name} "
            f"{frame_best_score:.3f}"
        )

        # Strong match.
        # No reason to keep hammering the camera.
        if frame_best_score >= 0.60:

            print(
                "[FACE] Strong match found."
            )

            break

        time.sleep(0.2)

    # ========================================================
    # FINAL RESULT
    # ========================================================

    print()
    print("==============================")

    print(
        f"[FACE] FINAL: {best_name}"
    )

    print(
        f"[FACE] SCORE: {best_score:.3f}"
    )

    print(
        f"[FACE] GOOD FRAMES: {good_frames}"
    )

    print(
        f"[FACE] SEEN FACE: {seen_face}"
    )

    print("==============================")

    # No face at all
    if not seen_face:

        return "ERR no_face"

    # Authorized face
    if best_score >= FACE_THRESHOLD:

        return f"OK {best_name}"

    # Face found but not authorized
    return "DENY unknown"


# ============================================================
# PLATE VERIFICATION
# ============================================================

def verify_plate():

    try:

        # Plate recognition needs higher resolution.
        print("[PLATE] Switching camera to VGA")

        set_size(FRAMESIZE_VGA)

        # Allow sensor to settle after resolution change.
        time.sleep(0.5)

        # Throw away a few frames.
        img = capture(
            n_discard=3
        )

    finally:

        # Return to QVGA for face recognition.
        print("[PLATE] Returning camera to QVGA")

        set_size(
            FRAMESIZE_QVGA
        )

    if img is None:

        return "ERR no_image"

    # Mirror correction
    img = cv2.flip(
        img,
        1
    )

    cv2.imwrite(
        "last_plate.jpg",
        img
    )

    gray = cv2.cvtColor(
        img,
        cv2.COLOR_BGR2GRAY
    )

    found = reader.readtext(
        gray,
        allowlist=ALLOWED
    )

    good = [
        (t.strip(), c)
        for _, t, c in found
        if c > 0.4
        and len(t.strip()) >= 3
    ]

    if not good:

        return "ERR no_text"

    keys = [
        norm(t)
        for t, _ in good
    ]

    # OCR may split a plate into two boxes.
    keys.append(
        "".join(keys)
    )

    print(
        "[PLATE] read:",
        [t for t, _ in good]
    )

    # Check authorized plates
    for k in keys:

        if k in authorized:

            return (
                f"OK {authorized[k]}"
            )

    # Nothing matched
    best_text = max(
        good,
        key=lambda x: x[1]
    )[0]

    return f"DENY {best_text}"


# ============================================================
# FLASK SERVER
# ============================================================

app = Flask(__name__)

busy = threading.Lock()


def text(s):

    return Response(
        s + "\n",
        mimetype="text/plain"
    )


# ============================================================
# PING
# ============================================================

@app.route("/ping")
def ping():

    return text("pong")


# ============================================================
# VERIFY
# ============================================================

@app.route("/verify")
def verify():

    kind = request.args.get(
        "type",
        ""
    )

    # Check request type
    if kind not in (
        "face",
        "plate"
    ):

        return text(
            "ERR bad_type"
        )

    # Prevent simultaneous verification
    if not busy.acquire(
        blocking=False
    ):

        return text(
            "ERR busy"
        )

    t0 = time.time()

    try:

        if kind == "face":

            result = verify_face()

        else:

            result = verify_plate()

    except requests.RequestException as e:

        print(
            "[SERVER] Camera error:",
            e
        )

        result = "ERR cam_offline"

    except Exception as e:

        print(
            "[SERVER] Server error:",
            repr(e)
        )

        result = "ERR server"

    finally:

        busy.release()

    elapsed = time.time() - t0

    print(
        f"[{kind}] {result} "
        f"({elapsed:.1f}s)"
    )

    return text(result)


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    print()
    print(
        "======================================"
    )
    print(
        "      WAREGUARD VERIFICATION SERVER"
    )
    print(
        "======================================"
    )

    print()
    print(
        "Ping:"
    )
    print(
        "http://192.168.0.111:5001/ping"
    )

    print()
    print(
        "Verify face:"
    )
    print(
        "http://192.168.0.111:5001/verify?type=face"
    )

    print()
    print(
        "Verify plate:"
    )
    print(
        "http://192.168.0.111:5001/verify?type=plate"
    )

    print()

    app.run(
        host="0.0.0.0",
        port=5001
    )