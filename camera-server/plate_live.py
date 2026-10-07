import threading, time
import cv2
import numpy as np
import easyocr
import re

PLATES_FILE = "plates.txt"
CONFUSE = str.maketrans("OIBSZQ", "018520")   # letters OCR often mixes up with digits

def norm(t):
    t = re.sub(r"[^A-Z0-9]", "", t.upper())
    return t.translate(CONFUSE)

def load_plates():
    d = {}
    with open(PLATES_FILE) as f:
        for line in f:
            if line.strip():
                plate, _, label = line.strip().partition(",")
                d[norm(plate)] = label
    return d

authorized = load_plates()
last_key = {"k": None}

IP = "192.168.137.226"      # your ESP32-CAM IP (check the Serial Monitor)
ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -"

reader = easyocr.Reader(["en"], gpu=False)
latest = {"frame": None, "ok": False}
result = {"text": "", "conf": 0.0, "status": ""}

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

def ocr_loop():
    while True:
        frame = latest["frame"]
        if frame is None:
            time.sleep(0.5)
            continue
        fixed = cv2.flip(frame, 1)
        big = cv2.resize(fixed, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
        found = reader.readtext(gray, allowlist=ALLOWED)
        good = [(t, c) for _, t, c in found if c > 0.4 and len(t.strip()) >= 3]
        if good:
            text, conf = max(good, key=lambda x: x[1])
            text = text.strip()
            key = norm(text)
            stable = (key == last_key["k"])      # same reading twice in a row
            last_key["k"] = key
            if stable and key in authorized:
                status = "AUTHORIZED"
            elif stable:
                status = "NOT AUTHORIZED"
            else:
                status = "READING..."
            result.update(text=text, conf=conf, status=status)
            print("Plate:", text, round(conf, 2), status)
        else:
            last_key["k"] = None
            result.update(text="", conf=0.0, status="")

threading.Thread(target=grab_loop, daemon=True).start()
threading.Thread(target=ocr_loop, daemon=True).start()

print("q = quit, s = save a snapshot")
while True:
    frame = latest["frame"]
    if frame is None:
        frame = np.zeros((240, 320, 3), np.uint8)
        cv2.putText(frame, "Waiting for camera...", (20, 120),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
    else:
        frame = cv2.flip(frame, 1)
        if not latest["ok"]:
            cv2.putText(frame, "NO SIGNAL", (10, 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                
        if result["text"]:
            st = result["status"]
            color = (0, 255, 0) if st == "AUTHORIZED" else \
                    (0, 0, 255) if st == "NOT AUTHORIZED" else (0, 255, 255)
            cv2.putText(frame, f'{result["text"]} {st}',
                        (10, frame.shape[0] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    cv2.imshow("ESP32-CAM plate test", cv2.resize(frame, None, fx=2, fy=2,
                                                  interpolation=cv2.INTER_CUBIC))
    key = cv2.waitKey(1) & 0xFF
    if key == ord("s") and latest["frame"] is not None:
        cv2.imwrite("snapshot.jpg", latest["frame"])
        print("Saved snapshot.jpg")
    if key == ord("q"):
        break

cv2.destroyAllWindows()