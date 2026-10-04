#pragma once

#include <Arduino.h>

// Create private_config.h locally for real deployment values. It is intentionally
// absent from the repository and must never contain authorization allowlists.
#if __has_include("private_config.h")
#include "private_config.h"
#endif

#ifndef FIRMWARE_WIFI_SSID
#define FIRMWARE_WIFI_SSID ""
#endif
#ifndef FIRMWARE_WIFI_PASSWORD
#define FIRMWARE_WIFI_PASSWORD ""
#endif
#ifndef FIRMWARE_FUNCTION_BASE_URL
#define FIRMWARE_FUNCTION_BASE_URL "https://<project-ref>.supabase.co/functions/v1"
#endif
#ifndef FIRMWARE_DEVICE_UID
#define FIRMWARE_DEVICE_UID ""
#endif
#ifndef FIRMWARE_DEVICE_HMAC_SECRET
#define FIRMWARE_DEVICE_HMAC_SECRET ""
#endif
#ifndef FIRMWARE_TLS_CA_CERTIFICATE_PEM
#define FIRMWARE_TLS_CA_CERTIFICATE_PEM ""
#endif
#ifndef FIRMWARE_RFID_DEMO_AREA_ID
#define FIRMWARE_RFID_DEMO_AREA_ID ""
#endif
#ifndef FIRMWARE_TRUCK_PIN_TEST_MODE
#define FIRMWARE_TRUCK_PIN_TEST_MODE 0
#endif
#ifndef FIRMWARE_TRUCK_PIN_TEST_AREA_ID
#define FIRMWARE_TRUCK_PIN_TEST_AREA_ID "eb5c5563-63ba-476d-87dd-3e8e2e69a276"
#endif

struct ServoSlotConfig {
  // Three physical prototype slots; each can be reassigned to a logical area.
  constexpr ServoSlotConfig() = default;
  constexpr ServoSlotConfig(const char* areaId, int signal, int lock, int unlock,
                            uint32_t duration)
      : representedAreaId(areaId),
        signalPin(signal),
        lockAngle(lock),
        unlockAngle(unlock),
        unlockDurationMs(duration) {}

  const char* representedAreaId = "";
  int signalPin = -1;
  int lockAngle = -1;
  int unlockAngle = -1;
  uint32_t unlockDurationMs = 5000;
};

struct LcdHardwareConfig {
  int rsPin = -1;
  int enablePin = -1;
  int data4Pin = -1;
  int data5Pin = -1;
  int data6Pin = -1;
  int data7Pin = -1;
  int sdaPin = -1;
  int sclPin = -1;
  uint8_t i2cAddress = 0;
  size_t columns = 0;
  size_t rows = 0;

  constexpr LcdHardwareConfig() = default;
  constexpr LcdHardwareConfig(int sda, int scl, uint8_t address, size_t width, size_t height)
      : sdaPin(sda), sclPin(scl), i2cAddress(address), columns(width), rows(height) {}
};

struct CameraConfig {
  // The board model, pins, frame size, JPEG quality, and PSRAM requirements
  // remain intentionally unassigned until the ESP32-CAM is confirmed.
  bool enabled = false;
};

struct ShiftRegisterConfig {
  // The data and clock lines share the existing MFRC522 SPI bus. RFID CS is
  // kept high while status outputs are shifted; latch is a separate control.
  int dataPin = 23;
  int clockPin = 18;
  int latchPin = 3;
};

struct RfidHardwareConfig {
  int sckPin = 18;
  int misoPin = 19;
  int mosiPin = 23;
  int chipSelectPin = 5;
  int resetPin = 4;
};

struct KeypadHardwareConfig {
  int rowPins[4] = {12, 13, 14, 16};
  int columnPins[4] = {17, 25, 26, 27};
};

// Safe placeholders only. Provide local values through a private, ignored
// configuration overlay in a later phase. Do not commit credentials here.
struct FirmwareConfig {
  const char* wifiSsid = FIRMWARE_WIFI_SSID;
  const char* wifiPassword = FIRMWARE_WIFI_PASSWORD;
  const char* functionBaseUrl = FIRMWARE_FUNCTION_BASE_URL;
  const char* deviceUid = FIRMWARE_DEVICE_UID;
  const char* tlsCaCertificatePem = FIRMWARE_TLS_CA_CERTIFICATE_PEM;
  // Supply only from a private, ignored local overlay. Never commit a value.
  const char* deviceSecret = FIRMWARE_DEVICE_HMAC_SECRET;
  // Logical area used for the sequential RFID demonstration. Keep empty until
  // a real warehouse-area UUID is selected; no UUID is invented here.
  const char* rfidDemoAreaId = FIRMWARE_RFID_DEMO_AREA_ID;
  bool truckPinSerialTestMode = FIRMWARE_TRUCK_PIN_TEST_MODE;
  const char* truckPinSerialTestAreaId = FIRMWARE_TRUCK_PIN_TEST_AREA_ID;
  // Keypad defaults are configurable because the physical keypad model is not
  // documented. No GPIO mapping is assumed in this phase.
  const char* keypadDemoAreaId = "";
  // DHT22 GPIO is intentionally unassigned until physical wiring is confirmed.
  int dht22DataPin = 33;
  uint32_t dht22ReadIntervalMs = 2000;
  // Smoke sensor model and GPIO are intentionally unassigned. Do not add a
  // library, ADC mode, voltage, or calibration until hardware is confirmed.
  int smokeSensorSignalPin = 34;
  uint32_t smokeSensorReadIntervalMs = 2000;
  size_t keypadMinimumPinLength = 4;
  size_t keypadMaximumPinLength = 6;
  uint32_t keypadInputTimeoutMs = 15000;
  char keypadConfirmKey = '#';
  char keypadClearKey = '*';
  char keypadCancelKey = 'C';
  const char* ntpServer = "pool.ntp.org";
  uint32_t requestTimeoutMs = 5000;
  uint32_t wifiRetryIntervalMs = 10000;
  uint32_t ntpTimeoutMs = 15000;
  // These are policy defaults until device-config supplies managed values.
  uint32_t truckManualAuthRelockDelayMs = 0;
  uint8_t lockdownFailureThreshold = 3;
  uint32_t lockdownFirstStageMs = 60000;
  uint32_t lockdownSecondStageMs = 120000;
  ServoSlotConfig servoSlots[3] = {
      {FIRMWARE_RFID_DEMO_AREA_ID, 2, 0, 90, 5000},
      {"", 15, 0, 90, 5000},
      {"", 32, 0, 90, 5000},
  };
  int buzzerSignalPin = 0;
  LcdHardwareConfig lcdHardware{21, 22, 0x27, 16, 2};
  ShiftRegisterConfig shiftRegisterHardware{};
  CameraConfig camera{};
  RfidHardwareConfig rfidHardware{};
  KeypadHardwareConfig keypadHardware{};
};

constexpr FirmwareConfig FIRMWARE_CONFIG{};
