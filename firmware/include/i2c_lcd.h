#pragma once

#include <Arduino.h>
#include <Wire.h>

#include "config.h"
#include "lcd.h"

class I2cLcdDriver final : public LcdDriverInterface {
 public:
  explicit I2cLcdDriver(const LcdHardwareConfig& config) : config_(config) {}

  bool begin() override {
    if (config_.sdaPin < 0 || config_.sclPin < 0 || config_.i2cAddress == 0) return false;
    Wire.begin(config_.sdaPin, config_.sclPin);
    Wire.beginTransmission(config_.i2cAddress);
    if (Wire.endTransmission() != 0) return false;
    delay(5);
    sendNibble(0x03, false);
    delay(5);
    sendNibble(0x03, false);
    delay(1);
    sendNibble(0x03, false);
    sendNibble(0x02, false);
    command(0x28);
    command(0x0C);
    command(0x06);
    clear();
    return true;
  }

  bool clear() override {
    command(0x01);
    delay(2);
    return true;
  }

  bool writeLines(const String& line1, const String& line2) override {
    writeLine(0, line1);
    writeLine(1, line2);
    return true;
  }

 private:
  void writeLine(uint8_t row, const String& value) {
    command(static_cast<uint8_t>(row == 0 ? 0x80 : 0xC0));
    for (size_t index = 0; index < config_.columns; ++index) {
      writeData(index < value.length() ? value[index] : ' ');
    }
  }

  void command(uint8_t value) { sendByte(value, false); }
  void writeData(uint8_t value) { sendByte(value, true); }

  void sendByte(uint8_t value, bool data) {
    sendNibble(static_cast<uint8_t>(value >> 4), data);
    sendNibble(static_cast<uint8_t>(value & 0x0F), data);
  }

  void sendNibble(uint8_t nibble, bool data) {
    const uint8_t value = static_cast<uint8_t>((nibble << 4) | 0x08 | (data ? 0x01 : 0x00));
    Wire.beginTransmission(config_.i2cAddress);
    Wire.write(static_cast<uint8_t>(value | 0x04));
    Wire.write(value);
    Wire.endTransmission();
  }

  const LcdHardwareConfig& config_;
};
