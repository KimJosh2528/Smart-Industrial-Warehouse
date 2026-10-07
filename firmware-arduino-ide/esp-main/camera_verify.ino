// =====================================================
// CAMERA VERIFY  (save as camera_verify.ino in the SAME folder as your main sketch)
//
// D35 button -> WareGuard asks the laptop (wareguard_server.py) -> laptop grabs a
// picture from the ESP32-CAM and checks it -> WareGuard opens the gate or denies.
//   STAFF mode : D35 = FACE check  -> opens the staff door
//   TRUCK mode : D35 = PLATE check -> opens the truck gate
// The mode is set on the server's /live page; this ESP32 follows it.
// =====================================================
#include <WiFi.h>
#include <HTTPClient.h>

// GPIO35 is INPUT ONLY and has NO internal pull-up.
// Wire: 10k resistor from D35 to 3.3V, push button between D35 and GND (pressed = LOW).
#define CAM_BTN_PIN   35

const char *VERIFY_HOST = "192.168.137.1";
const int VERIFY_PORT = 5001;

// Camera button filter: needs a long, steady press (a floating pin flickers).
const unsigned long CAM_PRESS_MS   = 300;   // must stay LOW this long to count as a press
const unsigned long CAM_RELEASE_MS = 300;   // (not used, kept from the original)

#define V_IDLE     0
#define V_RUNNING  1
#define V_DONE     2

volatile byte verifyState   = V_IDLE;
volatile byte verifyGateSel = GATE_STAFF;
char verifyReply[48] = "";

volatile int serverMode = -1;       // -1 = not known yet, otherwise GATE_STAFF or GATE_TRUCK


// ONE task that loops forever: asks the laptop which mode /live is in (STAFF or TRUCK).
// Created once in camVerifyBegin(), never re-created, so no memory leak.
void modeTask(void *arg) {
  for (;;) {
    if (WiFi.status() == WL_CONNECTED && verifyState == V_IDLE) {
      String url = String("http://") + VERIFY_HOST + ":" + String(VERIFY_PORT) + "/getmode";
      {
        HTTPClient http;
        http.setConnectTimeout(1000);
        http.setTimeout(1500);
        if (http.begin(url)) {
          if (http.GET() == 200) {
            String r = http.getString();
            r.trim();
            r.toUpperCase();
            if (r == "TRUCK") serverMode = GATE_TRUCK;
            else if (r == "STAFF") serverMode = GATE_STAFF;
          }
          http.end();
        }
      }
    }
    vTaskDelay(1000 / portTICK_PERIOD_MS);
  }
}


// The HTTP call can take several seconds (OCR runs on the laptop), so it runs in its own
// task. loop() keeps running meanwhile: fire alarm, smoke, door timers all stay alive.
void verifyTask(void *arg) {
  {
    String url = String("http://") + VERIFY_HOST + ":" + String(VERIFY_PORT) +
                 "/verify?type=auto";
    String reply = "ERR no_server";
    {
      HTTPClient http;
      http.setConnectTimeout(3000);
      http.setTimeout(20000);
      if (http.begin(url)) {
        int code = http.GET();
        if (code == 200) {
          reply = http.getString();
          reply.trim();
        } else if (code > 0) {
          reply = "ERR http_" + String(code);
        }
        http.end();
      }
    }
    reply.toCharArray(verifyReply, sizeof(verifyReply));
  }                                          // String and HTTPClient are freed here
  __sync_synchronize();
  verifyState = V_DONE;
  vTaskDelete(NULL);
}


void camVerifyBegin() {
  pinMode(CAM_BTN_PIN, INPUT);              // external pull-up, see above
  netBegin();                               // wg_net.ino owns WiFi, NTP and Supabase
  Serial.println("[CAMV] WiFi connecting in the background...");
  xTaskCreatePinnedToCore(modeTask, "mode", 6144, NULL, 1, NULL, 0);
}

void camButtonPressed() {
  Serial.println("[CAMV] Camera button pressed");

  if (fireAlarm) {
    showLCDStatus("FIRE! EVACUATE", "DOORS OPEN");
    return;
  }
  if (verifyState != V_IDLE) return;        // a check is already running
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[CAMV] No WiFi");
    showLCDStatus("CAMERA CHECK", "NO WIFI");
    return;
  }

  verifyGateSel = activeGate;               // STAFF = face, TRUCK = plate
  verifyState = V_RUNNING;
  if (xTaskCreatePinnedToCore(verifyTask, "verify", 8192, NULL, 1, NULL, 0) != pdPASS) {
    verifyState = V_IDLE;
    Serial.println("[CAMV] task create failed");
  }
}


void camVerifyFinish() {
  bool truck = (verifyGateSel == GATE_TRUCK);

  char *label = verifyReply;                // skip the OK / DENY / ERR word
  while (*label && *label != ' ') label++;
  while (*label == ' ') label++;

  Serial.printf("[CAMV] reply: %s\n", verifyReply);
  verifyState = V_IDLE;

  if (fireAlarm) return;                    // the fire alarm owns the doors

  char l1[20];
  if (strncmp(verifyReply, "OK", 2) == 0) {
    grantGate(verifyGateSel);
    snprintf(l1, sizeof(l1), "%s: %s", truck ? "PLATE" : "FACE", label);
    showLCDStatus(l1, truck ? "GATE UNLOCKED" : "DOOR UNLOCKED");
  } else if (strncmp(verifyReply, "DENY", 4) == 0) {
    accessDenied();
    snprintf(l1, sizeof(l1), "%s DENIED", truck ? "PLATE" : "FACE");
    showLCDStatus(l1, label);
  } else {
    showLCDStatus("CHECK FAILED", label);   // no face / no text / camera offline: just try again
  }
}


void camVerifyUpdate() {
  static bool wifiWasUp = false;
  static bool armed = false;                 // true after the pin was HIGH long enough
  static bool lastRaw = false;               // last raw reading (true = LOW)
  static unsigned long rawSince = 0;         // when the raw reading last changed
  static unsigned long lastShow = 0;
  static unsigned long lastHeap = 0;
  unsigned long now = millis();

  // WiFi status log (once per change)
  bool up = (WiFi.status() == WL_CONNECTED);
  if (up != wifiWasUp) {
    wifiWasUp = up;
    if (up) Serial.printf("[CAMV] WiFi up, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    else    Serial.println("[CAMV] WiFi lost");
  }

  // Follow the mode that the server's /live page is in
  if (serverMode != -1 && serverMode != activeGate) {
    setMode((byte)serverMode);
  }

  // Heap + mode + button pin log every 5 s
  if (now - lastHeap >= 5000) {
    lastHeap = now;
    Serial.printf("[CAMV] heap=%u server_mode=%d btn_pin=%d\n",
                  (unsigned)ESP.getFreeHeap(), (int)serverMode, digitalRead(CAM_BTN_PIN));
  }

  // Steady-press filter (original logic)
  bool raw = (digitalRead(CAM_BTN_PIN) == LOW);
  if (raw != lastRaw) {
    lastRaw = raw;
    rawSince = now;                          // any change restarts the timer
  }
  unsigned long held = now - rawSince;

  if (!raw) {
    armed = true;                            // any HIGH reading: ready for a new press
  }
  if (raw && armed && held >= CAM_PRESS_MS) {
    armed = false;                           // count this press once
    camButtonPressed();
  }

  if (verifyState == V_RUNNING) {
    if (now - lastShow >= 500) {            // keep the message up while the laptop works
      lastShow = now;
      showLCDStatus(verifyGateSel == GATE_TRUCK ? "READING PLATE" : "LOOKING AT FACE", "PLEASE WAIT");
    }
  } else if (verifyState == V_DONE) {
    camVerifyFinish();
  }
}