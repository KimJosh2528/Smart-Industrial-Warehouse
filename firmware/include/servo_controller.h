#pragma once

#include <Arduino.h>

#include "api_client.h"
#include "config.h"

enum class ServoDoorState {
  Unavailable,
  Locked,
  Unlocked,
  RelockPending,
  EmergencyUnlocked,
};

// Adapter boundary for the eventual confirmed servo library/driver. No
// library or GPIO behavior is assumed in Phase 13.
class ServoDriverInterface {
 public:
  virtual ~ServoDriverInterface() = default;
  virtual bool attach(int signalPin) = 0;
  virtual bool writeAngle(int angle) = 0;
  virtual void detach() = 0;
};

class GpioServoDriver final : public ServoDriverInterface {
 public:
  explicit GpioServoDriver(uint8_t channel) : channel_(channel) {}

  bool attach(int signalPin) override {
    if (signalPin < 0 || channel_ >= 16) return false;
    pin_ = signalPin;
    if (ledcSetup(channel_, 50, 16) == 0) return false;
    ledcAttachPin(pin_, channel_);
    return true;
  }

  bool writeAngle(int angle) override {
    if (pin_ < 0 || angle < 0 || angle > 180) return false;
    const uint32_t pulseUs = 500 + (static_cast<uint32_t>(angle) * 2000U / 180U);
    const uint32_t duty = pulseUs * 65535UL / 20000UL;
    ledcWrite(channel_, duty);
    return true;
  }

  void detach() override {
    if (pin_ >= 0) ledcDetachPin(pin_);
    pin_ = -1;
  }

 private:
  uint8_t channel_;
  int pin_ = -1;
};

class UnassignedServoDriver final : public ServoDriverInterface {
 public:
  bool attach(int signalPin) override {
    (void)signalPin;
    return false;
  }

  bool writeAngle(int angle) override {
    (void)angle;
    return false;
  }

  void detach() override {}
};

class ServoDoorLock {
 public:
  ServoDoorLock(const ServoSlotConfig& config, ServoDriverInterface& driver)
      : config_(config), driver_(driver) {}

  bool begin() {
    state_ = ServoDoorState::Unavailable;
    ready_ = false;
    if (config_.signalPin < 0 || config_.lockAngle < 0 || config_.unlockAngle < 0 ||
        config_.unlockDurationMs == 0) {
      Serial.println("[SERVO] Slot is unassigned; remains locked.");
      return false;
    }
    if (!driver_.attach(config_.signalPin) || !driver_.writeAngle(config_.lockAngle)) {
      driver_.detach();
      Serial.println("[SERVO] Driver unavailable; remains locked.");
      return false;
    }
    ready_ = true;
    state_ = ServoDoorState::Locked;
    Serial.println("[SERVO] Door-lock actuator initialized locked.");
    return true;
  }

  bool lock() {
    if (emergencyMode_) return false;
    if (!ready_ || !driver_.writeAngle(config_.lockAngle)) {
      state_ = ServoDoorState::Unavailable;
      return false;
    }
    state_ = ServoDoorState::Locked;
    return true;
  }

  bool unlock() {
    return unlockFor(config_.unlockDurationMs);
  }

  bool unlockFor(uint32_t durationMs) {
    if (emergencyMode_) return true;
    if (state_ == ServoDoorState::RelockPending) return true;
    if (!ready_ || durationMs == 0 || !driver_.writeAngle(config_.unlockAngle)) {
      state_ = ServoDoorState::Unavailable;
      return false;
    }
    state_ = ServoDoorState::RelockPending;
    relockAtMillis_ = millis() + durationMs;
    return true;
  }

  bool emergencyUnlock() {
    emergencyMode_ = true;
    if (!ready_ || !driver_.writeAngle(config_.unlockAngle)) {
      state_ = ServoDoorState::Unavailable;
      return false;
    }
    state_ = ServoDoorState::EmergencyUnlocked;
    return true;
  }

  void maintain() {
    if (state_ != ServoDoorState::RelockPending || emergencyMode_) return;
    if (static_cast<int32_t>(millis() - relockAtMillis_) >= 0) lock();
  }

  void shutdown() {
    if (ready_ && !emergencyMode_) lock();
    driver_.detach();
    ready_ = false;
    state_ = ServoDoorState::Unavailable;
  }

  ServoDoorState state() const { return state_; }
  bool isLocked() const {
    return state_ == ServoDoorState::Locked || state_ == ServoDoorState::Unavailable;
  }

  bool emergencyMode() const { return emergencyMode_; }

 private:
  const ServoSlotConfig& config_;
  ServoDriverInterface& driver_;
  ServoDoorState state_ = ServoDoorState::Unavailable;
  uint32_t relockAtMillis_ = 0;
  bool ready_ = false;
  bool emergencyMode_ = false;
};

class ServoAreaMapper {
 public:
  ServoAreaMapper(const ServoSlotConfig* slots, size_t slotCount)
      : slots_(slots), slotCount_(slotCount) {}

  int findSlot(const String& areaId) const {
    if (areaId.length() == 0) return -1;
    for (size_t index = 0; index < slotCount_; ++index) {
      const char* representedAreaId = slots_[index].representedAreaId;
      if (representedAreaId != nullptr && areaId == representedAreaId) {
        return static_cast<int>(index);
      }
    }
    return -1;
  }

  bool emergencyUnlockAll(ServoDoorLock* doors, size_t doorCount) const {
    bool allAccepted = true;
    const size_t count = slotCount_ < doorCount ? slotCount_ : doorCount;
    for (size_t index = 0; index < count; ++index) {
      if (!doors[index].emergencyUnlock()) allAccepted = false;
    }
    return count > 0 && allAccepted;
  }

 private:
  const ServoSlotConfig* slots_;
  size_t slotCount_;
};

class DoorAccessController {
 public:
  DoorAccessController(ServoAreaMapper& mapper, ServoDoorLock* doors, size_t doorCount)
      : mapper_(mapper), doors_(doors), doorCount_(doorCount) {}

  // Uses the existing API response classifier. Only an authorized response
  // can request unlock; every other result is fail-closed.
  bool handleAccessResponse(const String& areaId, const ApiResponse& response) {
    const int slot = mapper_.findSlot(areaId);
    if (slot < 0 || static_cast<size_t>(slot) >= doorCount_) return false;

    if (classifyAccessResponse(response) != AccessDecision::Authorized) {
      doors_[slot].lock();
      return false;
    }
    return doors_[slot].unlock();
  }

  bool handleManualTruckAccessResponse(const String& areaId, const ApiResponse& response,
                                       uint32_t extendedRelockDelayMs) {
    const int slot = mapper_.findSlot(areaId);
    if (slot < 0 || static_cast<size_t>(slot) >= doorCount_) return false;
    if (classifyAccessResponse(response) != AccessDecision::Authorized) {
      doors_[slot].lock();
      return false;
    }
    return doors_[slot].unlockFor(extendedRelockDelayMs);
  }

  bool emergencyUnlockAll() {
    return mapper_.emergencyUnlockAll(doors_, doorCount_);
  }

  void maintain() {
    for (size_t index = 0; index < doorCount_; ++index) doors_[index].maintain();
  }

 private:
  ServoAreaMapper& mapper_;
  ServoDoorLock* doors_;
  size_t doorCount_;
};
