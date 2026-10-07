import time
import requests
import cv2
import numpy as np
import easyocr

IP = "192.168.137.226"   # your ESP32-CAM IP

time.sleep(1)

# The first pictures after a size change can be old, so take a few and keep the last
img = None
for _ in range(4):
    r = requests.get(f"http://{IP}/capture", timeout=10)
    img = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
    time.sleep(0.5)

if img is None:
    raise SystemExit("No valid picture came back from the board.")

cv2.imwrite("plate.jpg", img)
print("Saved plate.jpg:", img.shape[1], "x", img.shape[0])

# Back to the small size so the face script stays smooth
requests.get(f"http://{IP}/control?var=framesize&val=5", timeout=10)

reader = easyocr.Reader(["en"], gpu=False)
results = reader.readtext("plate.jpg",
                          allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -")
if not results:
    print("No text found")
for box, text, conf in results:
    print(text, round(conf, 2))