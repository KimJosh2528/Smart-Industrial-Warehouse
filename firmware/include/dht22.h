#pragma once

#include <Arduino.h>
#include <DHT.h>
#include <cmath>

struct Dht22Reading {
  float temperatureC = NAN;
  float humidityPct = NAN;
};

struct Dht22Config {
  int dataPin = -1;
  uint32_t readIntervalMs = 2000;

  Dht22Config() = default;
  Dht22Config(int pin, uint32_t intervalMs)
      : dataPin(pin), readIntervalMs(intervalMs) {}
};

class Dht22Sensor {
 public:
  explicit Dht22Sensor(const Dht22Config& config)
      : config_(config), sensor_(config.dataPin >= 0 ? config.dataPin : 0, DHT22) {}

  bool begin() {
    if (config_.dataPin < 0) {
      Serial.println("[DHT22] Data GPIO is not configured.");
      return false;
    }
    sensor_.begin();
    initialized_ = true;
    lastReadMillis_ = millis() - config_.readIntervalMs;
    Serial.println("[DHT22] Sensor initialized.");
    return true;
  }

  bool readIfDue(Dht22Reading& reading) {
    if (!initialized_) return false;

    const uint32_t now = millis();
    if (static_cast<uint32_t>(now - lastReadMillis_) < config_.readIntervalMs) return false;
    lastReadMillis_ = now;

    const float temperatureC = sensor_.readTemperature();
    const float humidityPct = sensor_.readHumidity();
    if (isnan(temperatureC) || isinf(temperatureC) ||
        isnan(humidityPct) || isinf(humidityPct) ||
        temperatureC < -40.0f || temperatureC > 80.0f ||
        humidityPct < 0.0f || humidityPct > 100.0f) {
      if (!invalidReadingLogEmitted_ ||
          static_cast<uint32_t>(now - lastInvalidLogMillis_) >= 5000) {
        Serial.println("[DHT22] Invalid reading; sample discarded.");
        invalidReadingLogEmitted_ = true;
        lastInvalidLogMillis_ = now;
      }
      return false;
    }

    reading.temperatureC = temperatureC;
    reading.humidityPct = humidityPct;
    return true;
  }

 private:
  const Dht22Config& config_;
  DHT sensor_;
  uint32_t lastReadMillis_ = 0;
  uint32_t lastInvalidLogMillis_ = 0;
  bool initialized_ = false;
  bool invalidReadingLogEmitted_ = false;
};
