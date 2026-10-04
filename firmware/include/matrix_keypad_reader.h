#pragma once

#include <Arduino.h>

#include "config.h"
#include "keypad.h"

class MatrixKeypadReader final : public KeypadReaderInterface {
 public:
  explicit MatrixKeypadReader(const KeypadHardwareConfig& config) : config_(config) {}

  bool begin() override {
    for (int pin : config_.rowPins) pinMode(pin, INPUT_PULLUP);
    for (int pin : config_.columnPins) {
      pinMode(pin, OUTPUT);
      digitalWrite(pin, HIGH);
    }
    return true;
  }

  bool readKey(char& key) override {
    key = '\0';
    static const char keys[4][4] = {
        {'1', '2', '3', 'A'}, {'4', '5', '6', 'B'},
        {'7', '8', '9', 'C'}, {'*', '0', '#', 'D'}};
    const uint32_t now = millis();
    for (size_t column = 0; column < 4; ++column) {
      for (size_t index = 0; index < 4; ++index) digitalWrite(config_.columnPins[index], HIGH);
      digitalWrite(config_.columnPins[column], LOW);
      for (size_t row = 0; row < 4; ++row) {
        if (digitalRead(config_.rowPins[row]) != LOW) continue;
        const char candidate = keys[row][column];
        if (candidate == lastKey_ && static_cast<uint32_t>(now - lastKeyMillis_) < 75) return false;
        lastKey_ = candidate;
        lastKeyMillis_ = now;
        key = candidate;
        for (size_t index = 0; index < 4; ++index) digitalWrite(config_.columnPins[index], HIGH);
        return true;
      }
    }
    for (size_t index = 0; index < 4; ++index) digitalWrite(config_.columnPins[index], HIGH);
    return false;
  }

 private:
  const KeypadHardwareConfig& config_;
  char lastKey_ = '\0';
  uint32_t lastKeyMillis_ = 0;
};

// TEMPORARY: serial keypad test injection — remove when physical keypad is available
class SerialKeypadReader final : public KeypadReaderInterface {
 public:
  bool begin() override {
    return true;
  }

  bool readKey(char& key) override {
    key = '\0';
    if (Serial.available() <= 0) return false;
    const int c = Serial.read();
    if (c == '\r' || c == '\n') return false;
    key = static_cast<char>(c);
    Serial.printf("[SERIAL KEYPAD TEST] byte received: '%c' (0x%02X)\n", key, static_cast<uint8_t>(key));
    return true;
  }
};
// END TEMPORARY
