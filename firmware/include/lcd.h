#pragma once

#include <Arduino.h>

class LcdDriverInterface {
 public:
  virtual ~LcdDriverInterface() = default;
  virtual bool begin() = 0;
  virtual bool clear() = 0;
  virtual bool writeLines(const String& line1, const String& line2) = 0;
};

class UnassignedLcdDriver final : public LcdDriverInterface {
 public:
  bool begin() override { return false; }
  bool clear() override { return false; }
  bool writeLines(const String& line1, const String& line2) override {
    (void)line1;
    (void)line2;
    return false;
  }
};

class LcdController {
 public:
  explicit LcdController(LcdDriverInterface& driver) : driver_(driver) {}

  bool begin() {
    available_ = driver_.begin();
    if (!available_) Serial.println("[LCD] Model/interface is unassigned; display disabled.");
    return available_;
  }

  void clear() {
    if (available_) driver_.clear();
    line1_ = "";
    line2_ = "";
  }

  void show(const String& line1, const String& line2 = "") {
    if (line1 == line1_ && line2 == line2_) return;
    line1_ = line1;
    line2_ = line2;
    if (available_) driver_.writeLines(line1_, line2_);
  }

 private:
  LcdDriverInterface& driver_;
  String line1_;
  String line2_;
  bool available_ = false;
};
