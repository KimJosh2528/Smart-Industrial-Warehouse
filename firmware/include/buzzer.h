#pragma once

#include <Arduino.h>

enum class BuzzerPattern {
  None,
  Success,
  Denied,
  Error,
  Emergency,
};

class BuzzerDriverInterface {
 public:
  virtual ~BuzzerDriverInterface() = default;
  virtual bool begin(int signalPin) = 0;
  virtual bool setActive(bool active) = 0;
  virtual void stop() = 0;
};

class UnassignedBuzzerDriver final : public BuzzerDriverInterface {
 public:
  bool begin(int signalPin) override {
    (void)signalPin;
    return false;
  }

  bool setActive(bool active) override {
    (void)active;
    return false;
  }

  void stop() override {}
};

class BuzzerController {
 public:
  BuzzerController(int signalPin, BuzzerDriverInterface& driver)
      : signalPin_(signalPin), driver_(driver) {}

  bool begin() {
    available_ = signalPin_ >= 0 && driver_.begin(signalPin_);
    stop();
    if (!available_) Serial.println("[BUZZER] Unassigned; feedback disabled.");
    return available_;
  }

  void success() { start(BuzzerPattern::Success); }
  void denied() { start(BuzzerPattern::Denied); }
  void error() { start(BuzzerPattern::Error); }
  void emergency() { start(BuzzerPattern::Emergency); }

  void stop() {
    pattern_ = BuzzerPattern::None;
    step_ = 0;
    active_ = false;
    driver_.stop();
  }

  void maintain() {
    if (!available_ || pattern_ == BuzzerPattern::None) return;
    if (static_cast<int32_t>(millis() - nextChangeMillis_) < 0) return;

    if (pattern_ == BuzzerPattern::Emergency && step_ >= 6) {
      step_ = 0;
    }
    const uint8_t totalSteps = pattern_ == BuzzerPattern::Success ? 2
        : pattern_ == BuzzerPattern::Denied ? 4 : 6;
    if (step_ >= totalSteps) {
      stop();
      return;
    }

    active_ = (step_ % 2) == 0;
    driver_.setActive(active_);
    nextChangeMillis_ = millis() + (active_ ? 100 : 120);
    ++step_;
  }

 private:
  void start(BuzzerPattern pattern) {
    if (!available_) return;
    pattern_ = pattern;
    step_ = 0;
    nextChangeMillis_ = 0;
  }

  int signalPin_;
  BuzzerDriverInterface& driver_;
  BuzzerPattern pattern_ = BuzzerPattern::None;
  uint8_t step_ = 0;
  uint32_t nextChangeMillis_ = 0;
  bool active_ = false;
  bool available_ = false;
};
