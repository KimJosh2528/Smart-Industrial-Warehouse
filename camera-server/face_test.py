import threading, time
import os, re, urllib.request
import cv2
import numpy as np
import requests

IP = "192.168.137.182"      # your ESP32-CAM IP
FACES_DIR = "faces"         # folder with your photos
THRESHOLD = 0.363           # higher score = more similar; this is the standard cutoff

# --- download the two model files if they are missing ---
MODELS = {
    "yunet.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "sface.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
}
for name, url in MODELS.items():
    if not os.path.exists(name):
        print("Downloading", name, "...")
        urllib.request.urlretrieve(url, name)

detector = cv2.FaceDetectorYN.create("yunet.onnx", "", (320, 240), 0.6, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create("sface.onnx", "")

def find_faces(img):
    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    return faces if faces is not None else []

# --- learn the faces from the photos ---
known = []   # list of (name, feature)
for file in sorted(os.listdir(FACES_DIR)):
    if not file.lower().endswith((".jpg", ".jpeg", ".png")):
        continue
    img = cv2.imread(os.path.join(FACES_DIR, file))
    if img is None:
        continue
    if img.shape[1] > 800:  # shrink big phone photos
        scale = 800 / img.shape[1]
        img = cv2.resize(img, None, fx=scale, fy=scale)
    faces = find_faces(img)
    if len(faces) == 0:
        print("No face found in", file, "- skipped")
        continue
    best = max(faces, key=lambda f: f[2] * f[3])   # biggest face
    feature = recognizer.feature(recognizer.alignCrop(img, best))
    name = re.sub(r"[\d_\- ]+$", "", os.path.splitext(file)[0]) or file
    known.append((name, feature))
    print("Learned", name, "from", file)

if not known:
    raise SystemExit("No faces learned. Check the photos in the faces folder.")

# --- background thread: keeps fetching pictures so the window never freezes ---
latest = {"frame": None, "ok": True}

def grab_loop():
    while True:
        cap = cv2.VideoCapture(f"http://{IP}:81/stream")
        if not cap.isOpened():
            latest["ok"] = False
            print("Cannot open stream - check the IP and close browser tabs")
            time.sleep(2)
            continue
        while True:
            ok, img = cap.read()
            if not ok:
                latest["ok"] = False
                break
            latest["frame"] = img
            latest["ok"] = True
        cap.release()
        time.sleep(1)

threading.Thread(target=grab_loop, daemon=True).start()

print("Press q in the video window to quit.")
while True:
    frame = latest["frame"]
    if frame is None:
        frame = np.zeros((240, 320, 3), np.uint8)
        cv2.putText(frame, "Waiting for camera...", (20, 120),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
    else:
        frame = frame.copy()
        for face in find_faces(frame):
            feature = recognizer.feature(recognizer.alignCrop(frame, face))
            best_name, best_score = "unknown", 0.0
            for name, kf in known:
                score = recognizer.match(feature, kf, cv2.FaceRecognizerSF_FR_COSINE)
                if score > best_score:
                    best_name, best_score = name, score
            if best_score < THRESHOLD:
                best_name = "unknown"
            x, y, w, h = map(int, face[:4])
            color = (0, 255, 0) if best_name != "unknown" else (0, 0, 255)
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            cv2.putText(frame, f"{best_name} {best_score:.2f}", (x, max(y - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        if not latest["ok"]:
            cv2.putText(frame, "NO SIGNAL", (10, 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

    cv2.imshow("ESP32-CAM face test",
           cv2.resize(frame, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cv2.destroyAllWindows()