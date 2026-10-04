#pragma once

#include <Arduino.h>
#include <cmath>

enum class SmokeSensorStatus {
  Unavailable,
  Valid,
  Invalid,
};

// Model-neutral smoke reading. The unit is intentionally unspecified until
// the physical smoke sensor is confirmed and calibrated.
struct SmokeSensorReading {
  SmokeSensorStatus status = SmokeSensorStatus::Unavailable;
  float smokeValue = NAN;
};

struct SmokeSensorConfig {
  int signalPin = -1;
  uint32_t readIntervalMs = 2000;

  SmokeSensorConfig() = default;
  SmokeSensorConfig(int pin, uint32_t intervalMs)
      : signalPin(pin), readIntervalMs(intervalMs) {}
};

class SmokeSensor {
 public:
  explicit SmokeSensor(const SmokeSensorConfig& config) : config_(config) {}

  bool begin() {
    if (config_.signalPin < 0) {
      Serial.println("[SMOKE] Sensor model/GPIO is not configured.");
      return false;
    }

    pinMode(config_.signalPin, INPUT);
    initialized_ = true;
    Serial.println("[SMOKE] Analog smoke sensor initialized.");
    return true;
  }

  SmokeSensorReading sampleForCycle() {
    SmokeSensorReading reading;
    if (!initialized_) return reading;

    const int raw = analogRead(config_.signalPin);
    if (raw < 0) {
      reading.status = SmokeSensorStatus::Invalid;
      return reading;
    }
    reading.status = SmokeSensorStatus::Valid;
    reading.smokeValue = static_cast<float>(raw);
    return reading;
  }

 private:
  const SmokeSensorConfig& config_;
  bool initialized_ = false;
};
