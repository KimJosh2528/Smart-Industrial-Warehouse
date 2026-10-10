#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include "mbedtls/md.h"
#include "secrets.h"

// =====================================================
// PIN CONFIGURATION
// =====================================================

// RC522
#define RFID_SS_PIN        5
#define RFID_RST_PIN       4
#define RFID_SCK_PIN       18
#define RFID_MISO_PIN      19
#define RFID_MOSI_PIN      23

// Servos
#define DOOR_SERVO_PIN       2
#define FIRE_EXIT_SERVO_PIN  12
#define TRUCK_SERVO_PIN      14     // NEW: truck gate (export / import / parking)

// Access LEDs / buzzer
#define GREEN_LED_PIN      25
#define RED_LED_PIN        26
#define ACCESS_BUZZER      27

// Fire alarm LED
#define FIRE_LED_PIN       13

// Sensors
#define DHT11_PIN          32
#define MQ2_PIN            34

// Fire-exit warning
// CHANGED: was 14. D14 is now the truck servo, so this output moved to 13.
// D13 is shared with FIRE_LED_PIN, so during a fire the D13 LED blinks with the buzzer.
#define EXIT_RED_LED_PIN   13
#define EXIT_BUZZER        33

// I2C LCD
#define LCD_SDA_PIN        21
#define LCD_SCL_PIN        22

// Exit push buttons (other leg to GND, internal pull-up, pressed = LOW)
#define STAFF_EXIT_BTN_PIN 17
#define FIRE_EXIT_BTN_PIN  15
#define TRUCK_EXIT_BTN_PIN 16       // NEW: truck gate exit push button


// =====================================================
// OBJECTS
// =====================================================

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);


// =====================================================
// AUTHORIZED RFID UID
// =====================================================

// Keep the demo card authorized and also allow the registered guard tag.
// UIDs are stored as bytes because that is what MFRC522 returns.
const byte authorizedUIDs[][4] = {
  { 0xB0, 0x88, 0xC4, 0x5C }  // Kim Joshua guard tag (b088c45c)
};
const byte AUTHORIZED_UID_SIZE = 4;
const byte AUTHORIZED_UID_COUNT = sizeof(authorizedUIDs) / sizeof(authorizedUIDs[0]);


// =====================================================
// MQ-2 SETTINGS (level based on the reading only)
// =====================================================

// true  = AO goes UP with smoke (normal MQ-2 module)
// false = your board's reading goes DOWN with smoke
const bool SMOKE_RISES_WITH_GAS = true;

// Levels use the 0-1023 scale (raw ESP32 reading / 4)
#define SMOKE_NORMAL  0     // below 450
#define SMOKE_WARNING 1     // 450 to 649
#define SMOKE_DANGER  2     // 650 and above
const int  SMOKE_WARN_LEVEL   = 450;
const int  SMOKE_DANGER_LEVEL = 650;
const int  SMOKE_HYST         = 10;    // must fall this far below a level to leave it

const unsigned long SMOKE_WARMUP_MS = 30000UL;
const byte SMOKE_CONFIRM_WARN  = 2;    // 2 x 500 ms = 1 s to enter WARNING
const byte SMOKE_CONFIRM_COUNT = 12;   // 12 x 500 ms = 6 s to enter DANGER
const byte SMOKE_CLEAR_COUNT   = 1;    // 1 x 500 ms = 0.5 s to go DOWN a level
const byte SMOKE_SAMPLES       = 16;
const int  SMOKE_MAX_NOISE     = 400;  // sample spread above this = bad reading
const int  SMOKE_ADC_TOO_LOW   = 50;   // sensor/wiring fault
const unsigned long SERVO_SETTLE_MS = 600;
const unsigned long DISTURB_MS      = 1500;

unsigned long smokeIgnoreUntil = 0;
unsigned long systemStartTime = 0;
byte smokeLevel = SMOKE_NORMAL;
bool smokePendingUp = false;                 // direction of the sample count (true = going up)
byte smokePendingCount = 0;
int  smokeValue10 = 0;
int  smokeSpread = 0;
bool smokeNoisy = false;


// =====================================================
// ALARM LEVELS
// =====================================================

const float TEMP_WARN_C        = 35.0;
const float TEMP_FIRE_C        = 35.0;
const float TEMP_CLEAR_HYST_C  = 5.0;
const float HUM_WARN_PCT       = 80.0;

const unsigned long TEMP_RISE_WINDOW_MS = 30000UL;
const float TEMP_RISE_C                 = 5.0;
const unsigned long SMOKE_ESCALATE_MS   = 40000UL;

bool fireAlarm = false;
bool tempRisingFast = false;
unsigned long smokeStartTime = 0;

float tempRef = 0;
unsigned long tempRefTime = 0;
bool tempRefValid = false;


// =====================================================
// SERVO SETTINGS
// =====================================================

#define SERVO_FREQUENCY    50
#define SERVO_RESOLUTION   16
#define SERVO_LOCK_ANGLE    0
#define SERVO_UNLOCK_ANGLE  90

bool doorServoAttached = false;
bool exitServoAttached = false;
int  doorAngle = -1;
int  exitAngle = -1;


// =====================================================
// DOOR / ACCESS STATE (non-blocking)
// =====================================================

bool doorUnlocked = false;
unsigned long doorUnlockUntil = 0;
unsigned long deniedUntil = 0;
const unsigned long DOOR_OPEN_MS   = 5000;
const unsigned long DENIED_SHOW_MS = 2000;

// Fire exit servo timer (normal exit via push button)
bool exitUnlocked = false;
unsigned long exitUnlockUntil = 0;
const unsigned long EXIT_OPEN_MS = 5000;

// NEW: truck gate (same style as the staff door)
bool truckServoAttached = false;
int  truckAngle = -1;
bool truckUnlocked = false;
unsigned long truckUnlockUntil = 0;
const unsigned long TRUCK_OPEN_MS = 5000;

// Continuous-rotation truck servo calibration.
// IMPORTANT: this servo has NO position feedback, so the gate position is
// controlled by direction + travel time. Tune these values to your actual gate.
const unsigned long TRUCK_OPEN_TRAVEL_MS  = 600;
const unsigned long TRUCK_CLOSE_TRAVEL_MS = 595;

// Keep these equally spaced from neutral (1500 us) so OPEN/CLOSE speed is
// as symmetrical as possible.
const int TRUCK_NEUTRAL_US = 1490;
const int TRUCK_OPEN_US    = 1300;
const int TRUCK_CLOSE_US   = 1700;
unsigned long truckDriveUntil = 0;

void truckPulse(int us) {
  us = constrain(us, 1000, 2000);
  ledcWrite(TRUCK_SERVO_PIN, ((uint64_t)us * 65535ULL) / 20000ULL);
}

// NEW: typed command line ("staff auth", "truck auth")
char cmdBuf[32];
byte cmdLen = 0;


// =====================================================
// EXIT BUTTONS
// =====================================================

const unsigned long BTN_DEBOUNCE_MS = 50;
bool staffRawLast = false;
bool staffStable = false;
unsigned long staffChangeTime = 0;
bool fireBtnRawLast = false;
bool fireBtnStable = false;
unsigned long fireBtnChangeTime = 0;
bool truckBtnRawLast = false;                 // NEW
bool truckBtnStable = false;                  // NEW
unsigned long truckBtnChangeTime = 0;         // NEW


// =====================================================
// TIMERS
// =====================================================

unsigned long lastDHTRead = 0;
unsigned long lastSmokeRead = 0;
unsigned long lastLCDUpdate = 0;
unsigned long exitAlarmBlinkTime = 0;
bool exitAlarmState = false;

const unsigned long DHT_INTERVAL   = 2000;
const unsigned long SMOKE_INTERVAL = 500;
const unsigned long LCD_INTERVAL   = 300;


// =====================================================
// SENSOR VALUES
// =====================================================

float currentTemperature = 0.0;
float currentHumidity = 0.0;

bool dhtValid = false;
byte dhtFailCount = 0;
const byte DHT_MAX_FAILS = 3;
portMUX_TYPE dhtMux = portMUX_INITIALIZER_UNLOCKED;

int currentSmokeValue = 0;
bool smokeDetected = false;      // true only at DANGER level

// =====================================================
// LCD STATE (own PCF8574 driver, no library needed)
// =====================================================

byte lcdAddress = 0x27;
bool lcdOnline = false;
bool lcdBacklightOn = true;
char lcdCache[2][17] = { "", "" };
bool lcdForce = true;
bool lcdReinitPending = false;
unsigned long lcdReinitAt = 0;

char statusL1[17] = "";
char statusL2[17] = "";
unsigned long statusUntil = 0;
const unsigned long LCD_STATUS_TIME = 2000;


// =====================================================
// FUNCTION DECLARATIONS
// =====================================================

void setServoAngle(int pin, int angle);
void markDisturbance();
void startupHardwareTest();
bool readDHT11Sensor();
void readDHT11();
void updateTempRise();
int  readSmokeAveraged();
byte smokeLevelFor(int v, byte cur);
void checkSmokeSensor();
void resetBaseline();
void updateSafetyState();
void updateDoor();
void showLCDStatus(const char *line1, const char *line2);
void updateLCD();
void lcdInit();
void lcdWrite(const char *l1, const char *l2);
bool lcdFindAddress();
void scanI2CBus();
void checkRFID();
bool isAuthorizedCard();
String currentRfidCredentialHash();
void accessGranted();
void accessDenied();
void updateButtons();
void staffExitPressed();
void fireExitPressed();
void truckExitPressed();                      // NEW
void truckAccessGranted();                    // NEW
void updateTruckGate();                       // NEW
void handleSerialLine(const char *raw);       // NEW
bool wgAuthorizeAccess(const String& areaId, const String& credentialType, const String& credentialHash);

// Functions that live in camera_verify.ino (declared here so this tab always sees them)
void camVerifyBegin();
void camVerifyUpdate();
void wgQueueAccessEvent(const String& areaId, const String& credentialType, const String& credentialHash);

// NEW: one switch point for "which gate gets opened"
#define GATE_STAFF  0
#define GATE_TRUCK  1
void grantGate(byte gate);

// NEW: mode = which gate the shared RFID reader, the "auth" command and the
// staff / truck exit buttons work with. Starts as STAFF.
// The fire exit button always works, whatever the mode.
byte activeGate = GATE_STAFF;
void setMode(byte gate);
const char *activeRfidAreaId = DEMO_GATE_AREA_ID;
// RFID area selection is independent from the camera/authentication mode.
// The camera may be in TRUCK mode while the physical RFID reader is testing
// a staff entrance, so never use activeGate for RFID authorization.
byte activeRfidGate = GATE_STAFF;
void setRfidArea(const char *areaId, const char *label);


// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  systemStartTime = millis();

  Serial.println("\n==========================================");
  Serial.println("WAREGUARD SYSTEM STARTING");
  Serial.println("[FW] ESP-MAIN DHT11-HEAD-REVERT");
  Serial.println("==========================================");

  analogReadResolution(12);
  analogSetPinAttenuation(MQ2_PIN, ADC_11db);

  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(FIRE_LED_PIN, OUTPUT);
  pinMode(ACCESS_BUZZER, OUTPUT);
  pinMode(EXIT_RED_LED_PIN, OUTPUT);
  pinMode(EXIT_BUZZER, OUTPUT);
  pinMode(MQ2_PIN, INPUT);
  pinMode(DHT11_PIN, INPUT_PULLUP);
  pinMode(STAFF_EXIT_BTN_PIN, INPUT_PULLUP);
  pinMode(FIRE_EXIT_BTN_PIN, INPUT_PULLUP);
  pinMode(TRUCK_EXIT_BTN_PIN, INPUT_PULLUP);       // NEW

  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(FIRE_LED_PIN, LOW);
  digitalWrite(ACCESS_BUZZER, LOW);
  digitalWrite(EXIT_RED_LED_PIN, LOW);
  digitalWrite(EXIT_BUZZER, LOW);

  // LCD first
  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  Wire.setClock(100000);
  scanI2CBus();
  lcdFindAddress();
  lcdInit();
  lcdWrite("WAREGUARD", "Starting...");

  // Servos
  doorServoAttached = ledcAttach(DOOR_SERVO_PIN, SERVO_FREQUENCY, SERVO_RESOLUTION);
  exitServoAttached = ledcAttach(FIRE_EXIT_SERVO_PIN, SERVO_FREQUENCY, SERVO_RESOLUTION);
  truckServoAttached = ledcAttach(TRUCK_SERVO_PIN, SERVO_FREQUENCY, SERVO_RESOLUTION);   // NEW
  // Attach only. Send NO pulse at boot, so the servos stay still until we interact.
  // Just record that the gates are assumed to be in the locked position.
  doorAngle  = SERVO_LOCK_ANGLE;
  exitAngle  = SERVO_LOCK_ANGLE;
  truckAngle = SERVO_LOCK_ANGLE;

  // RC522
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  rfid.PCD_Init();

  delay(100);

  Serial.println("[TEST] CAM VERIFY SETUP START");
  camVerifyBegin();
  Serial.println("[TEST] CAM VERIFY SETUP DONE");

  delay(2000);
  readDHT11();
  checkSmokeSensor();
  updateLCD();

  Serial.println("==========================================");
  Serial.println("SYSTEM READY");
  Serial.println("Type + Enter:  RFID STAFF | RFID ELECTRONIC | auth | staff auth | truck auth | r");
  Serial.println("==========================================");
}


// =====================================================
// LOOP
// =====================================================

void loop() {
  unsigned long now = millis();

  // CHANGED: reads whole lines so "staff auth" and "truck auth" work.
  // Set the Serial Monitor line ending to Newline. Type r + Enter to reset the smoke state.
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      cmdBuf[cmdLen] = '\0';
      if (cmdLen > 0) handleSerialLine(cmdBuf);
      cmdLen = 0;
    } else if (cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    }
  }

  if (now - lastDHTRead >= DHT_INTERVAL) {
    lastDHTRead = now;
    readDHT11();
  }

  if (now - lastSmokeRead >= SMOKE_INTERVAL) {
    lastSmokeRead = now;
    checkSmokeSensor();
  }

  updateButtons();
  updateSafetyState();
  updateDoor();
  updateTruckGate();      // NEW

  if (truckDriveUntil != 0 && (long)(now - truckDriveUntil) >= 0) {
    truckDriveUntil = 0;
    truckPulse(TRUCK_NEUTRAL_US);      // hunong sa neutral human sa travel time
  }

  if (now - lastLCDUpdate >= LCD_INTERVAL) {
    lastLCDUpdate = now;
    updateLCD();
  }

  checkRFID();
  camVerifyUpdate();

  delay(20);
}


// =====================================================
// I2C SCAN
// =====================================================

void scanI2CBus() {
  byte foundCount = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print("[I2C] Device found at 0x");
      if (addr < 0x10) Serial.print("0");
      Serial.println(addr, HEX);
      foundCount++;
    }
  }
  if (foundCount == 0) {
    Serial.println("[I2C] WARNING: No devices found. Check SDA/SCL wires and LCD 5V/GND.");
  }
}


// =====================================================
// STARTUP HARDWARE TEST
// =====================================================

void startupHardwareTest() {
  digitalWrite(GREEN_LED_PIN, HIGH); delay(300); digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, HIGH);   delay(300); digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(FIRE_LED_PIN, HIGH);  delay(300); digitalWrite(FIRE_LED_PIN, LOW);
  digitalWrite(ACCESS_BUZZER, HIGH); delay(150); digitalWrite(ACCESS_BUZZER, LOW);
  digitalWrite(EXIT_RED_LED_PIN, HIGH);
  digitalWrite(EXIT_BUZZER, HIGH);
  delay(300);
  digitalWrite(EXIT_RED_LED_PIN, LOW);
  digitalWrite(EXIT_BUZZER, LOW);
}


// =====================================================
// SERVO (only moves when the angle changes)
// =====================================================

void markDisturbance() {
  unsigned long until = millis() + DISTURB_MS;
  if ((long)(until - smokeIgnoreUntil) > 0) smokeIgnoreUntil = until;
}

void setServoAngle(int pin, int angle) {
  if (pin == DOOR_SERVO_PIN) {
    if (!doorServoAttached || angle == doorAngle) return;
    doorAngle = angle;
  } else if (pin == FIRE_EXIT_SERVO_PIN) {
    if (!exitServoAttached || angle == exitAngle) return;
    exitAngle = angle;
  } else if (pin == TRUCK_SERVO_PIN) {
    if (!truckServoAttached || angle == truckAngle) return;
    truckAngle = angle;
    truckPulse(angle == SERVO_UNLOCK_ANGLE ? TRUCK_OPEN_US : TRUCK_CLOSE_US);
    truckDriveUntil = millis() + (angle == SERVO_UNLOCK_ANGLE ? TRUCK_OPEN_TRAVEL_MS : TRUCK_CLOSE_TRAVEL_MS);
    markDisturbance();
    lcdReinitPending = true;
    lcdReinitAt = truckDriveUntil + SERVO_SETTLE_MS;   // after the servo stops
    return;
  } else {
    return;
  }

  angle = constrain(angle, 0, 180);
  int pulseWidth = map(angle, 0, 180, 500, 2400);
  uint32_t duty = ((uint64_t)pulseWidth * 65535ULL) / 20000ULL;
  ledcWrite(pin, duty);

  markDisturbance();
  lcdReinitPending = true;                       // servo spikes can reset the LCD
  lcdReinitAt = millis() + SERVO_SETTLE_MS + 100;
}


// =====================================================
// DHT11
// =====================================================

static bool dhtTimed(byte *data) {
  unsigned long t = micros();
  while (digitalRead(DHT11_PIN) == HIGH) { if (micros() - t > 200) return false; }
  t = micros();
  while (digitalRead(DHT11_PIN) == LOW)  { if (micros() - t > 200) return false; }
  t = micros();
  while (digitalRead(DHT11_PIN) == HIGH) { if (micros() - t > 200) return false; }

  for (int i = 0; i < 40; i++) {
    t = micros();
    while (digitalRead(DHT11_PIN) == LOW)  { if (micros() - t > 200) return false; }
    unsigned long highStart = micros();
    while (digitalRead(DHT11_PIN) == HIGH) { if (micros() - highStart > 200) return false; }
    unsigned long highDuration = micros() - highStart;

    data[i / 8] <<= 1;
    if (highDuration > 40) data[i / 8] |= 1;
  }
  return true;
}

bool readDHT11Sensor() {
  byte data[5] = { 0, 0, 0, 0, 0 };

  pinMode(DHT11_PIN, OUTPUT);
  digitalWrite(DHT11_PIN, LOW);
  delay(20);
  digitalWrite(DHT11_PIN, HIGH);
  delayMicroseconds(30);
  pinMode(DHT11_PIN, INPUT_PULLUP);

  portENTER_CRITICAL(&dhtMux);
  bool ok = dhtTimed(data);
  portEXIT_CRITICAL(&dhtMux);
  if (!ok) return false;
  byte checksum = data[0] + data[1] + data[2] + data[3];
  if (checksum != data[4]) return false;

  currentHumidity = data[0];
  currentTemperature = data[2];
  return true;
}

void readDHT11() {
  bool ok = false;
  for (byte attempt = 0; attempt < 3 && !ok; attempt++) {
    ok = readDHT11Sensor();
    if (!ok) delay(100);
  }

  if (ok) {
    dhtValid = true;
    dhtFailCount = 0;
    updateTempRise();
  } else {
    if (dhtFailCount < 255) dhtFailCount++;
    if (dhtFailCount >= DHT_MAX_FAILS) dhtValid = false;
  }
}

void updateTempRise() {
  unsigned long now = millis();
  if (!tempRefValid) {
    tempRef = currentTemperature;
    tempRefTime = now;
    tempRefValid = true;
    return;
  }

  if (now - tempRefTime >= TEMP_RISE_WINDOW_MS) {
    float rise = currentTemperature - tempRef;
    tempRisingFast = (rise >= TEMP_RISE_C);
    tempRef = currentTemperature;
    tempRefTime = now;
  }
}


// =====================================================
// MQ-2 (NORMAL / WARNING / DANGER from the reading only)
// =====================================================

// Sorted sampling: drops outliers, averages the middle half.
int readSmokeAveraged() {
  int s[SMOKE_SAMPLES];
  for (byte i = 0; i < SMOKE_SAMPLES; i++) {
    s[i] = analogRead(MQ2_PIN);
    delayMicroseconds(300);
  }
  for (byte i = 1; i < SMOKE_SAMPLES; i++) {          // insertion sort
    int v = s[i];
    int j = i - 1;
    while (j >= 0 && s[j] > v) { s[j + 1] = s[j]; j--; }
    s[j + 1] = v;
  }
  smokeSpread = s[SMOKE_SAMPLES - 1] - s[0];

  byte lo = SMOKE_SAMPLES / 4;
  byte hi = SMOKE_SAMPLES - lo;
  uint32_t sum = 0;
  for (byte i = lo; i < hi; i++) sum += s[i];
  return (int)(sum / (hi - lo));
}

// Same name kept so the "r" command still works: clears the smoke state.
void resetBaseline() {
  smokeLevel = SMOKE_NORMAL;
  smokePendingUp = false;
  smokePendingCount = 0;
  smokeDetected = false;
  Serial.println("[MQ2] Smoke state reset");
}

// Level from the reading only, with a small gap so it does not flicker
byte smokeLevelFor(int v, byte cur) {
  if (v >= SMOKE_DANGER_LEVEL) return SMOKE_DANGER;
  if (cur == SMOKE_DANGER && v >= SMOKE_DANGER_LEVEL - SMOKE_HYST) return SMOKE_DANGER;
  if (v >= SMOKE_WARN_LEVEL) return SMOKE_WARNING;
  if (cur >= SMOKE_WARNING && v >= SMOKE_WARN_LEVEL - SMOKE_HYST) return SMOKE_WARNING;
  return SMOKE_NORMAL;
}

void checkSmokeSensor() {
  bool warmingUp = (millis() - systemStartTime) < SMOKE_WARMUP_MS;
  // Only pause detection after servo/buzzer activity while normal; clearing still works.
  bool disturbed = (smokeLevel == SMOKE_NORMAL) && ((long)(smokeIgnoreUntil - millis()) > 0);

  currentSmokeValue = readSmokeAveraged();
  int signal = SMOKE_RISES_WITH_GAS ? currentSmokeValue : (4095 - currentSmokeValue);
  smokeValue10 = signal / 4;                 // 12-bit -> 0-1023 scale

  if (warmingUp || disturbed) {
    smokePendingCount = 0;
    return;
  }

  // Dead sensor / wiring fault: always ignore
  if (currentSmokeValue <= SMOKE_ADC_TOO_LOW) {
    smokePendingCount = 0;
    return;
  }

  // Noisy burst: reject it only while NORMAL (protects against false alarms).
  // While in WARNING/DANGER the middle-half average is good enough, and the
  // buzzer/servo noise of the alarm must not keep resetting the clear counter.
  smokeNoisy = (smokeSpread > SMOKE_MAX_NOISE);
  if (smokeNoisy && smokeLevel == SMOKE_NORMAL) {
    smokePendingCount = 0;
    return;
  }

  byte target = smokeLevelFor(smokeValue10, smokeLevel);

  // Reading agrees with the current level: nothing is pending
  if (target == smokeLevel) {
    smokePendingCount = 0;
    return;
  }

  // One counter per direction. It restarts only when the direction flips,
  // so a reading that jumps straight past WARNING keeps counting for both levels.
  bool goingUp = (target > smokeLevel);
  if (goingUp != smokePendingUp) {
    smokePendingUp = goingUp;
    smokePendingCount = 0;
  }
  smokePendingCount++;

  byte newLevel = smokeLevel;
  bool keepCount = false;

  if (goingUp) {
    if (target == SMOKE_DANGER) {
      if (smokePendingCount >= SMOKE_CONFIRM_COUNT) {
        newLevel = SMOKE_DANGER;                          // 6 s above the danger level
      } else if (smokeLevel == SMOKE_NORMAL && smokePendingCount >= SMOKE_CONFIRM_WARN) {
        newLevel = SMOKE_WARNING;                         // 1 s: show WARNING first
        keepCount = true;                                 // keep counting toward DANGER
      }
    } else if (smokePendingCount >= SMOKE_CONFIRM_WARN) { // target is WARNING
      newLevel = SMOKE_WARNING;
    }
  } else if (smokePendingCount >= SMOKE_CLEAR_COUNT) {
    newLevel = target;                                    // going down
  }

  if (newLevel != smokeLevel) {
    smokeLevel = newLevel;
    if (!keepCount) smokePendingCount = 0;
    smokeDetected = (smokeLevel == SMOKE_DANGER);         // danger feeds the fire logic
    if (smokeDetected) smokeStartTime = millis();

    if (smokeLevel == SMOKE_DANGER)       Serial.println("[MQ2] DANGER");
    else if (smokeLevel == SMOKE_WARNING) Serial.println("[MQ2] WARNING");
    else                                  Serial.println("[MQ2] Normal");
  }
}


// =====================================================
// SAFETY STATE & ALARM OUTPUTS
// =====================================================

void updateSafetyState() {
  const bool fireAlarmBefore = fireAlarm;
  bool tempHigh     = dhtValid && (currentTemperature >= TEMP_FIRE_C);
  bool smokeTooLong = smokeDetected && ((millis() - smokeStartTime) >= SMOKE_ESCALATE_MS);
  // A rapid temperature rise is independently dangerous; sustained/high smoke
  // still requires the smoke signal so a brief MQ-2 spike does not alarm.
  bool fireCondition = tempRisingFast || (smokeDetected && (tempHigh || smokeTooLong));

  if (!fireAlarm) {
    if (fireCondition) {
      fireAlarm = true;
      doorUnlocked = false;
      exitUnlocked = false;                 // alarm takes over the exit servo
      setServoAngle(FIRE_EXIT_SERVO_PIN, SERVO_UNLOCK_ANGLE);
      setServoAngle(DOOR_SERVO_PIN, SERVO_UNLOCK_ANGLE);
      truckUnlocked = false;                                    // NEW
      setServoAngle(TRUCK_SERVO_PIN, SERVO_UNLOCK_ANGLE);       // NEW: truck gate opens in a fire
      digitalWrite(FIRE_LED_PIN, HIGH);
      digitalWrite(GREEN_LED_PIN, LOW);

      exitAlarmState = true;
      exitAlarmBlinkTime = millis();
      digitalWrite(EXIT_RED_LED_PIN, HIGH);
      digitalWrite(EXIT_BUZZER, HIGH);
      if (tempHigh && smokeDetected) Serial.println("[FIRE] ALARM ON: high temperature + high smoke");
      else if (smokeTooLong) Serial.println("[FIRE] ALARM ON: long smoke exposure");
      else if (tempRisingFast) Serial.println("[FIRE] ALARM ON: sudden high temperature");
      else Serial.println("[FIRE] ALARM ON");
    }
  } else {
    bool tempStillHot = dhtValid && (currentTemperature >= (TEMP_FIRE_C - TEMP_CLEAR_HYST_C));
    // The alarm stops ONLY when the readings are safe again (no auto-clear timer).
    if (!smokeDetected && !tempStillHot) {
      fireAlarm = false;
      tempRisingFast = false;
      setServoAngle(FIRE_EXIT_SERVO_PIN, SERVO_LOCK_ANGLE);
      setServoAngle(DOOR_SERVO_PIN, SERVO_LOCK_ANGLE);
      setServoAngle(TRUCK_SERVO_PIN, SERVO_LOCK_ANGLE);         // NEW
      digitalWrite(FIRE_LED_PIN, LOW);
      digitalWrite(EXIT_RED_LED_PIN, LOW);
      digitalWrite(EXIT_BUZZER, LOW);
      markDisturbance();
      Serial.println("[FIRE] ALARM CLEARED");
    }
  }

  // Switch the LCD immediately when the alarm turns on/off instead of waiting
  // for the regular environmental refresh interval.
  if (fireAlarm != fireAlarmBefore) updateLCD();

  static unsigned long lastSafetyPrint = 0;
  if (millis() - lastSafetyPrint >= 1000) {
    lastSafetyPrint = millis();

    Serial.print("[STATUS] Temp=");
    if (dhtValid) Serial.print(currentTemperature, 1); else Serial.print("ERR");
    Serial.print("C | Hum=");
    if (dhtValid) Serial.print(currentHumidity, 1); else Serial.print("ERR");
    Serial.print("% | MQ2=");
    Serial.print(currentSmokeValue);
    Serial.print(" | Spread=");
    Serial.print(smokeSpread);
    Serial.print(" | Level10=");
    Serial.print(smokeValue10);
    Serial.print(" | Pend=");
    Serial.print(smokePendingUp ? "+" : "-");
    Serial.print(smokePendingCount);
    Serial.print(smokeNoisy ? " NOISY" : "");
    Serial.print(" | Smoke=");
    Serial.print(smokeLevel == SMOKE_DANGER ? "DANGER" : smokeLevel == SMOKE_WARNING ? "WARNING" : "NORMAL");
    Serial.print(" | FIRE=");
    Serial.print(fireAlarm ? "ON" : "OFF");
    Serial.print(" | LCD=");
    Serial.println(lcdOnline ? "OK" : "OFFLINE");
  }

  // Fire-exit LED + buzzer: ONLY while the real FIRE alarm is on
  if (fireAlarm) {
    if (millis() - exitAlarmBlinkTime >= 250) {
      exitAlarmBlinkTime = millis();
      exitAlarmState = !exitAlarmState;
      digitalWrite(EXIT_RED_LED_PIN, exitAlarmState ? HIGH : LOW);
      digitalWrite(EXIT_BUZZER, exitAlarmState ? HIGH : LOW);
    }
  } else {
    digitalWrite(EXIT_RED_LED_PIN, LOW);
    digitalWrite(EXIT_BUZZER, LOW);
    exitAlarmState = false;
  }
}


// =====================================================
// DOOR TIMERS
// =====================================================

void updateDoor() {
  unsigned long now = millis();

  if (deniedUntil != 0 && (long)(now - deniedUntil) >= 0) {
    deniedUntil = 0;
    digitalWrite(RED_LED_PIN, LOW);
    digitalWrite(ACCESS_BUZZER, LOW);
    markDisturbance();
  }

  if (doorUnlocked && !fireAlarm && (long)(now - doorUnlockUntil) >= 0) {
    doorUnlocked = false;
    setServoAngle(DOOR_SERVO_PIN, SERVO_LOCK_ANGLE);
    if (!exitUnlocked) digitalWrite(GREEN_LED_PIN, LOW);     // keep green on while exit is open
  }

  // Fire exit servo closes 5 s after the push button
  if (exitUnlocked && !fireAlarm && (long)(now - exitUnlockUntil) >= 0) {
    exitUnlocked = false;
    setServoAngle(FIRE_EXIT_SERVO_PIN, SERVO_LOCK_ANGLE);
    if (!doorUnlocked) digitalWrite(GREEN_LED_PIN, LOW);
  }
}


// =====================================================
// LCD DRIVER (PCF8574 backpack: P0=RS P1=RW P2=EN P3=BL P4-7=D4-D7)
// =====================================================

bool lcdExpWrite(byte v) {
  Wire.beginTransmission(lcdAddress);
  Wire.write((byte)(v | (lcdBacklightOn ? 0x08 : 0x00)));
  return Wire.endTransmission() == 0;
}

void lcdPulse(byte v) {
  lcdExpWrite(v | 0x04);              // EN high
  delayMicroseconds(2);
  lcdExpWrite(v & ~0x04);             // EN low
  delayMicroseconds(60);
}

void lcdSend4(byte nib, byte rs) {
  lcdPulse(((nib & 0x0F) << 4) | rs);
}

void lcdSendByte(byte v, byte rs) {
  lcdSend4(v >> 4, rs);
  lcdSend4(v & 0x0F, rs);
}

void lcdCommand(byte c) {
  lcdSendByte(c, 0);
  if (c <= 0x03) delay(3);            // clear / home are slow
}

bool lcdFindAddress() {
  const byte tryAddr[2] = { 0x27, 0x3F };
  for (byte i = 0; i < 2; i++) {
    Wire.beginTransmission(tryAddr[i]);
    if (Wire.endTransmission() == 0) {
      lcdAddress = tryAddr[i];
      Serial.print("[LCD] Found at 0x");
      Serial.println(lcdAddress, HEX);
      return true;
    }
  }
  Serial.println("[LCD] NOT FOUND at 0x27 or 0x3F - check SDA/SCL and 5V power");
  return false;
}

void lcdInit() {
  Wire.beginTransmission(lcdAddress);
  lcdOnline = (Wire.endTransmission() == 0);
  if (!lcdOnline) return;

  delay(50);
  lcdExpWrite(0x00);
  delay(10);
  lcdSend4(0x03, 0); delay(5);        // force 8-bit mode three times
  lcdSend4(0x03, 0); delay(5);
  lcdSend4(0x03, 0); delay(2);
  lcdSend4(0x02, 0); delay(2);        // switch to 4-bit mode
  lcdCommand(0x28);                   // 4-bit, 2 lines, 5x8 font
  lcdCommand(0x0C);                   // display on, cursor off
  lcdCommand(0x01);                   // clear
  lcdCommand(0x06);                   // entry mode: increment
  lcdForce = true;
  lcdCache[0][0] = '\0';
  lcdCache[1][0] = '\0';
}

void lcdPrintAt(byte col, byte row, const char *s) {
  lcdCommand(0x80 | (col + (row ? 0x40 : 0x00)));
  while (*s) lcdSendByte((byte)*s++, 1);
}

// Writes two 16-char lines; only touches lines that changed (no flicker)
void lcdWrite(const char *l1, const char *l2) {
  if (!lcdOnline) return;
  char buf[2][17];
  snprintf(buf[0], sizeof(buf[0]), "%-16s", l1);
  snprintf(buf[1], sizeof(buf[1]), "%-16s", l2);

  for (byte r = 0; r < 2; r++) {
    if (lcdForce || strcmp(buf[r], lcdCache[r]) != 0) {
      lcdPrintAt(0, r, buf[r]);
      strcpy(lcdCache[r], buf[r]);
    }
  }
  lcdForce = false;
}

void showLCDStatus(const char *line1, const char *line2) {
  snprintf(statusL1, sizeof(statusL1), "%s", line1);
  snprintf(statusL2, sizeof(statusL2), "%s", line2);
  statusUntil = millis() + LCD_STATUS_TIME;
  // The LCD is reserved for the environmental monitor.  Access/mode status
  // remains available in Serial output and must not replace the sensor view.
}

void updateLCD() {
  static unsigned long lastCheck = 0;
  static unsigned long lastRefresh = 0;
  unsigned long now = millis();

  // Health check: is the LCD still answering on I2C?
  if (now - lastCheck >= 2000) {
    lastCheck = now;
    Wire.beginTransmission(lcdAddress);
    bool ok = (Wire.endTransmission() == 0);
    if (!ok) {
      lcdOnline = false;
      lcdFindAddress();                 // maybe it is on the other address
    }
    if (!lcdOnline) lcdInit();          // (re)start when it comes back
  }

  if (lcdReinitPending && (long)(now - lcdReinitAt) >= 0) {
    lcdReinitPending = false;
    lcdInit();
  }

  if (now - lastRefresh >= 5000) {      // cheap redraw, no clear, no flicker
    lastRefresh = now;
    lcdForce = true;
  }

  char a[20], b[20];

  if (fireAlarm) {
    lcdWrite("FIRE! EVACUATE", "EXIT DOOR OPEN");
    return;
  }

  // Normal LCD view: environmental readings only.  Fire alarm has priority
  // above and replaces this view with the evacuation message.
  if (dhtValid) {
    snprintf(a, sizeof(a), "T:%dC H:%d%%",
             (int)currentTemperature, (int)currentHumidity);
  } else {
    snprintf(a, sizeof(a), "T:ERR H:ERR");
  }

  const char *smokeState = smokeLevel == SMOKE_DANGER ? "DANGER" :
                           smokeLevel == SMOKE_WARNING ? "WARN" : "NORMAL";
  snprintf(b, sizeof(b), "Gas:%d %s", smokeValue10, smokeState);
  lcdWrite(a, b);
}


// =====================================================
// RFID & ACCESS
// =====================================================

void checkRFID() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  Serial.print("[RFID] UID:");
  for (byte i = 0; i < rfid.uid.size; i++) Serial.printf(" %02X", rfid.uid.uidByte[i]);
  Serial.println();

  const bool knownLocalUid = isAuthorizedCard();
  const String areaId = String(activeRfidAreaId);
  const String credentialHash = currentRfidCredentialHash();
  const bool permittedByCloud = areaId.length() > 0 &&
    wgAuthorizeAccess(areaId, "staff_rfid", credentialHash);
  const bool staffRfidMode = activeRfidGate == GATE_STAFF;

  // Fail closed: the UID must be known locally AND the cloud must confirm
  // the credential is active and permitted for this exact area. A staff or
  // guard RFID can never open the truck gate.
  if (staffRfidMode && knownLocalUid && permittedByCloud) grantGate(GATE_STAFF);
  else accessDenied();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

String currentRfidCredentialHash() {
  String canonical;
  canonical.reserve(rfid.uid.size * 2);
  for (byte i = 0; i < rfid.uid.size; i++) {
    char byteHex[3];
    snprintf(byteHex, sizeof(byteHex), "%02x", rfid.uid.uidByte[i]);
    canonical += byteHex;
  }

  unsigned char digest[32];
  mbedtls_md_context_t context;
  mbedtls_md_init(&context);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info || mbedtls_md_setup(&context, info, 0) != 0 ||
      mbedtls_md_starts(&context) != 0 ||
      mbedtls_md_update(&context, reinterpret_cast<const unsigned char*>(canonical.c_str()), canonical.length()) != 0 ||
      mbedtls_md_finish(&context, digest) != 0) {
    mbedtls_md_free(&context);
    return "";
  }
  mbedtls_md_free(&context);

  String hash;
  hash.reserve(64);
  for (byte i = 0; i < sizeof(digest); i++) {
    char byteHex[3];
    snprintf(byteHex, sizeof(byteHex), "%02x", digest[i]);
    hash += byteHex;
  }
  return hash;
}

bool isAuthorizedCard() {
  if (rfid.uid.size != AUTHORIZED_UID_SIZE) return false;
  for (byte candidate = 0; candidate < AUTHORIZED_UID_COUNT; candidate++) {
    bool matches = true;
    for (byte i = 0; i < AUTHORIZED_UID_SIZE; i++) {
      if (rfid.uid.uidByte[i] != authorizedUIDs[candidate][i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

void accessGranted() {
  if (fireAlarm) {
    showLCDStatus("FIRE! EVACUATE", "DOORS OPEN");
    return;
  }

  digitalWrite(GREEN_LED_PIN, HIGH);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(ACCESS_BUZZER, LOW);
  deniedUntil = 0;

  setServoAngle(DOOR_SERVO_PIN, SERVO_UNLOCK_ANGLE);
  doorUnlocked = true;
  doorUnlockUntil = millis() + DOOR_OPEN_MS;

  showLCDStatus("ACCESS GRANTED", "DOOR UNLOCKED");
}

void accessDenied() {
  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, HIGH);
  digitalWrite(ACCESS_BUZZER, HIGH);
  deniedUntil = millis() + DENIED_SHOW_MS;
  markDisturbance();

  if (!fireAlarm) showLCDStatus("ACCESS DENIED", "DOOR LOCKED");
}


// =====================================================
// EXIT BUTTONS
// =====================================================

// Staff exit push button: opens ONLY the staff door servo for 5 s.
// This physical exit is independent of the selected RFID/camera mode.
void staffExitPressed() {
  Serial.println("[BTN] Staff exit pressed");

  if (fireAlarm) {
    showLCDStatus("FIRE! EVACUATE", "DOORS OPEN");
    return;
  }

  digitalWrite(GREEN_LED_PIN, HIGH);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(ACCESS_BUZZER, LOW);
  deniedUntil = 0;

  setServoAngle(DOOR_SERVO_PIN, SERVO_UNLOCK_ANGLE);
  doorUnlocked = true;
  doorUnlockUntil = millis() + DOOR_OPEN_MS;

  showLCDStatus("STAFF EXIT", "DOOR UNLOCKED");
}

// Fire exit push button: opens ONLY the fire exit servo for 5 s (normal exit, no alarm).
// Always works, whatever the mode.
void fireExitPressed() {
  Serial.println("[BTN] Fire exit button pressed");

  if (fireAlarm) {
    showLCDStatus("FIRE! EVACUATE", "DOORS OPEN");
    return;
  }

  digitalWrite(GREEN_LED_PIN, HIGH);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(ACCESS_BUZZER, LOW);
  deniedUntil = 0;

  setServoAngle(FIRE_EXIT_SERVO_PIN, SERVO_UNLOCK_ANGLE);
  exitUnlocked = true;
  exitUnlockUntil = millis() + EXIT_OPEN_MS;

  showLCDStatus("FIRE EXIT", "DOOR UNLOCKED");
}

// NEW: Truck exit push button: opens ONLY the truck gate servo for 5 s.
// Only works while TRUCK mode is active.
void truckExitPressed() {
  Serial.printf("[BTN] Truck exit pressed | mode=%s fire=%d truckAngle=%d\n",
                activeGate == GATE_TRUCK ? "TRUCK" : "STAFF", fireAlarm, truckAngle);

  if (fireAlarm) {
    showLCDStatus("FIRE! EVACUATE", "DOORS OPEN");
    return;
  }

  digitalWrite(GREEN_LED_PIN, HIGH);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(ACCESS_BUZZER, LOW);
  deniedUntil = 0;

  setServoAngle(TRUCK_SERVO_PIN, SERVO_UNLOCK_ANGLE);
  truckUnlocked = true;
  truckUnlockUntil = millis() + TRUCK_OPEN_MS;

  showLCDStatus("TRUCK EXIT", "GATE UNLOCKED");
}

void updateButtons() {
  unsigned long now = millis();

  bool staffRaw = (digitalRead(STAFF_EXIT_BTN_PIN) == LOW);
  bool fireRaw  = (digitalRead(FIRE_EXIT_BTN_PIN) == LOW);
  bool truckRaw = (digitalRead(TRUCK_EXIT_BTN_PIN) == LOW);   // NEW

  // Staff exit: act once per debounced press
  if (staffRaw != staffRawLast) {
    staffRawLast = staffRaw;
    staffChangeTime = now;
  }
  if ((now - staffChangeTime) >= BTN_DEBOUNCE_MS && staffRaw != staffStable) {
    staffStable = staffRaw;
    if (staffStable) staffExitPressed();
  }

  // Fire exit: act once per debounced press
  if (fireRaw != fireBtnRawLast) {
    fireBtnRawLast = fireRaw;
    fireBtnChangeTime = now;
  }
  if ((now - fireBtnChangeTime) >= BTN_DEBOUNCE_MS && fireRaw != fireBtnStable) {
    fireBtnStable = fireRaw;
    if (fireBtnStable) fireExitPressed();
  }

  // NEW: Truck exit: act once per debounced press
  if (truckRaw != truckBtnRawLast) {
    truckBtnRawLast = truckRaw;
    truckBtnChangeTime = now;
  }
  if ((now - truckBtnChangeTime) >= BTN_DEBOUNCE_MS && truckRaw != truckBtnStable) {
    truckBtnStable = truckRaw;
    if (truckBtnStable) truckExitPressed();
  }
}


// =====================================================
// NEW: TYPED COMMANDS + TRUCK GATE
// =====================================================

void handleSerialLine(const char *raw) {
  String s(raw);
  s.trim();
  s.toUpperCase();

  if (s == "R") {
    resetBaseline();
  } else if (s == "RFID STAFF") {
    setRfidArea(DEMO_GATE_AREA_ID, "STAFF MAIN ENTRANCE");
  } else if (s == "RFID ELECTRONIC") {
    setRfidArea(DEMO_ELECTRONIC_AREA_ID, "ELECTRONIC SUPPLY ENTRANCE");
  } else if (s == "STAFF AUTH") {
    Serial.println("[CMD] staff auth");
    grantGate(GATE_STAFF);
  } else if (s == "TRUCK AUTH") {
    Serial.println("[CMD] truck auth");
    grantGate(GATE_TRUCK);

  } else if (s == "AUTH") {
    Serial.println("[CMD] auth (active gate)");
    grantGate(activeGate);
  } else if (s.length() > 0) {
    Serial.println("[CMD] unknown: " + s);
  }
}

void setMode(byte gate) {
  activeGate = gate;
  if (gate == GATE_TRUCK) {
    Serial.println("[MODE] TRUCK - RFID, 'auth' and the truck exit button open the truck gate");
    showLCDStatus("MODE: TRUCK", "RFID+EXIT=GATE");
  } else {
    Serial.println("[MODE] STAFF - RFID, 'auth' and the staff exit button open the staff door");
    showLCDStatus("MODE: STAFF", "RFID+EXIT=DOOR");
  }
}

void setRfidArea(const char *areaId, const char *label) {
  activeRfidAreaId = areaId;
  activeRfidGate = GATE_STAFF;
  Serial.println(String("[RFID AREA] ") + label);
  showLCDStatus("RFID AREA", label);
}

// The switch: pick a gate, and that gate's own open/close logic runs.
// Staff keeps its existing logic. To add another door later, add a #define and a case.
void grantGate(byte gate) {
  switch (gate) {
    case GATE_STAFF:
      accessGranted();            // existing staff logic, unchanged
      break;
    case GATE_TRUCK:
      truckAccessGranted();
      break;
    default:
      Serial.println("[GATE] unknown gate");
      break;
  }
}

void truckAccessGranted() {
  if (fireAlarm) {
    showLCDStatus("FIRE! EVACUATE", "DOORS OPEN");
    return;
  }

  digitalWrite(GREEN_LED_PIN, HIGH);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(ACCESS_BUZZER, LOW);
  deniedUntil = 0;

  setServoAngle(TRUCK_SERVO_PIN, SERVO_UNLOCK_ANGLE);
  truckUnlocked = true;
  truckUnlockUntil = millis() + TRUCK_OPEN_MS;

  showLCDStatus("TRUCK ACCESS", "GATE UNLOCKED");
}

void updateTruckGate() {
  if (!truckUnlocked || fireAlarm) return;

  if ((long)(millis() - truckUnlockUntil) >= 0) {
    truckUnlocked = false;
    setServoAngle(TRUCK_SERVO_PIN, SERVO_LOCK_ANGLE);
    if (!doorUnlocked && !exitUnlocked) digitalWrite(GREEN_LED_PIN, LOW);
  } else {
    digitalWrite(GREEN_LED_PIN, HIGH);   // shared green LED stays on while the gate is open
  }
}
