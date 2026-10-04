#pragma once

#include <Arduino.h>

#include "buzzer.h"
#include "config.h"

class ShiftRegisterOutput {
 public:
  explicit ShiftRegisterOutput(const ShiftRegisterConfig& config) : config_(config) {}

  bool begin() {
    if (config_.dataPin < 0 || config_.clockPin < 0 || config_.latchPin < 0) return false;
    pinMode(config_.dataPin, OUTPUT);
    pinMode(config_.clockPin, OUTPUT);
    pinMode(config_.latchPin, OUTPUT);
    digitalWrite(config_.latchPin, LOW);
    writeState(0);
    ready_ = true;
    return true;
  }

  bool ready() const { return ready_; }

  void setBit(uint8_t bit, bool enabled) {
    if (!ready_ || bit >= 8) return;
    if (enabled) state_ |= static_cast<uint8_t>(1U << bit);
    else state_ &= static_cast<uint8_t>(~(1U << bit));
    writeState(state_);
  }

  void clear() {
    if (ready_) writeState(0);
  }

 private:
  void writeState(uint8_t state) {
    digitalWrite(config_.latchPin, LOW);
    shiftOut(config_.dataPin, config_.clockPin, LSBFIRST, state);
    digitalWrite(config_.latchPin, HIGH);
    state_ = state;
  }

  const ShiftRegisterConfig& config_;
  uint8_t state_ = 0;
  bool ready_ = false;
};

class ShiftRegisterBuzzerDriver final : public BuzzerDriverInterface {
 public:
  explicit ShiftRegisterBuzzerDriver(ShiftRegisterOutput& output, uint8_t bit)
      : output_(output), bit_(bit) {}

  bool begin(int signalPin) override {
    (void)signalPin;
    return output_.ready();
  }

  bool setActive(bool active) override {
    output_.setBit(bit_, active);
    return true;
  }

  void stop() override { output_.setBit(bit_, false); }

 private:
  ShiftRegisterOutput& output_;
  uint8_t bit_;
};

class SecurityIndicators {
 public:
  explicit SecurityIndicators(ShiftRegisterOutput& output) : output_(output) {}

  void staffGranted() { setResult(0, 1); }
  void staffDenied() { setResult(1, 0); }
  void truckGranted() { setResult(2, 3); }
  void truckDenied() { setResult(3, 2); }
  void clearAccessResults() {
    output_.setBit(0, false);
    output_.setBit(1, false);
    output_.setBit(2, false);
    output_.setBit(3, false);
  }
  void emergency(bool active) { output_.setBit(4, active); }
  void maintain(uint32_t now) {
    if (resultUntil_ != 0 && static_cast<int32_t>(now - resultUntil_) >= 0) {
      clearAccessResults();
      resultUntil_ = 0;
    }
  }

 private:
  void setResult(uint8_t onBit, uint8_t offBit) {
    clearAccessResults();
    output_.setBit(onBit, true);
    output_.setBit(offBit, false);
    resultUntil_ = millis() + 5000;
  }

  ShiftRegisterOutput& output_;
  uint32_t resultUntil_ = 0;
};
