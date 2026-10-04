#pragma once

#include <Arduino.h>
#include <time.h>

#include "config.h"

class TimeManager {
 public:
  explicit TimeManager(const FirmwareConfig& config) : config_(config) {}

  bool beginSynchronization() {
    if (config_.ntpServer == nullptr || config_.ntpServer[0] == '\0') {
      Serial.println("[NTP] Server is not configured.");
      return false;
    }
    configTime(0, 0, config_.ntpServer, "time.nist.gov");
    synchronizationRequested_ = true;
    synchronized_ = false;
    networkWasAvailable_ = true;
    Serial.println("[NTP] Synchronization requested.");
    return true;
  }

  bool synchronize() {
    if (!beginSynchronization()) return false;

    const uint32_t deadline = millis() + config_.ntpTimeoutMs;
    time_t now = time(nullptr);
    while (now < 100000 && millis() < deadline) {
      delay(250);
      now = time(nullptr);
    }

    if (now < 100000) {
      Serial.println("[NTP] Synchronization unavailable.");
      synchronized_ = false;
      return false;
    }

    synchronized_ = true;
    synchronizationRequested_ = false;
    networkWasAvailable_ = true;
    Serial.print("[NTP] Synchronized. Unix time: ");
    Serial.println(static_cast<unsigned long>(now));
    return true;
  }

  bool available() const {
    return synchronized_ && time(nullptr) >= 100000;
  }

  void maintain(bool networkAvailable) {
    if (!networkAvailable) {
      networkWasAvailable_ = false;
      return;
    }
    if (!networkWasAvailable_) beginSynchronization();
    if (synchronizationRequested_ && time(nullptr) >= 100000) {
      synchronized_ = true;
      synchronizationRequested_ = false;
      Serial.print("[NTP] Synchronized. Unix time: ");
      Serial.println(static_cast<unsigned long>(time(nullptr)));
    }
  }

  uint32_t unixTimestamp() const {
    return static_cast<uint32_t>(time(nullptr));
  }

 private:
  const FirmwareConfig& config_;
  bool synchronized_ = false;
  bool networkWasAvailable_ = false;
  bool synchronizationRequested_ = false;
};
