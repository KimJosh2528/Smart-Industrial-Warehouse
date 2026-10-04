#pragma once

#include "lcd.h"

class StatusDisplays {
 public:
  explicit StatusDisplays(LcdController& display) : display_(display) {}

  void begin() {
    emergencyActive_ = false;
    display_.begin();
    showIdle();
  }

  void staffGranted() {
    if (emergencyActive_) return;
    display_.show("STAFF ACCESS", "GRANTED");
    statusUntil_ = millis() + 5000;
  }
  void staffDenied() {
    if (emergencyActive_) return;
    display_.show("STAFF ACCESS", "DENIED");
    statusUntil_ = millis() + 5000;
  }
  void truckGranted() {
    if (emergencyActive_) return;
    display_.show("TRUCK ACCESS", "GRANTED");
    statusUntil_ = millis() + 5000;
  }
  void truckDenied() {
    if (emergencyActive_) return;
    display_.show("TRUCK ACCESS", "DENIED");
    statusUntil_ = millis() + 5000;
  }
  void safetyNormal() {
    if (emergencyActive_) return;
    display_.show("SYSTEM NORMAL", "READY");
  }
  void safetyWarning() {
    if (emergencyActive_) return;
    display_.show("SAFETY WARNING", "CHECK SYSTEM");
  }
  void emergency() {
    emergencyActive_ = true;
    statusUntil_ = 0;
    display_.show("FIRE / EMERGENCY", "ALL DOORS OPEN");
  }
  void lockdown() {
    if (emergencyActive_) return;
    display_.show("ACCESS LOCKED", "TRY AGAIN LATER");
  }

  void showIdle() {
    if (emergencyActive_) return;
    display_.show("SYSTEM NORMAL", "READY");
  }

  void maintain(uint32_t now) {
    if (emergencyActive_) return;
    if (statusUntil_ != 0 && static_cast<int32_t>(now - statusUntil_) >= 0) {
      showIdle();
      statusUntil_ = 0;
    }
  }

 private:
  LcdController& display_;
  uint32_t statusUntil_ = 0;
  bool emergencyActive_ = false;
};
