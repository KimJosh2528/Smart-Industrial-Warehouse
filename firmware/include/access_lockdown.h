#pragma once

#include <Arduino.h>

struct AreaLockdownState {
  String areaId;
  uint16_t failedAttemptCount = 0;
  bool lockdownActive = false;
  uint32_t lockdownStartedAt = 0;
  uint32_t lockdownDuration = 0;
  uint8_t lockdownStage = 0;
};

class AccessLockdownManager {
 public:
  AccessLockdownManager(uint8_t failureThreshold, uint32_t firstStageMs,
                        uint32_t secondStageMs)
      : failureThreshold_(failureThreshold), firstStageMs_(firstStageMs),
        secondStageMs_(secondStageMs) {}

  bool isLockedDown(const String& areaId, uint32_t now) {
    AreaLockdownState* state = find(areaId);
    if (state == nullptr) return !hasCapacity();
    expire(*state, now);
    return state->lockdownActive;
  }

  bool canTrack(const String& areaId) const {
    for (const AreaLockdownState& state : states_) {
      if (state.areaId == areaId || state.areaId.length() == 0) return true;
    }
    return false;
  }

  bool recordFailure(const String& areaId, uint32_t now) {
    AreaLockdownState* statePointer = getOrCreate(areaId);
    if (statePointer == nullptr) return false;
    AreaLockdownState& state = *statePointer;
    expire(state, now);
    ++state.failedAttemptCount;
    if (failureThreshold_ == 0 || state.failedAttemptCount % failureThreshold_ != 0) return true;
    state.lockdownStage = static_cast<uint8_t>(state.failedAttemptCount / failureThreshold_);
    state.lockdownDuration = state.lockdownStage <= 1 ? firstStageMs_ : secondStageMs_;
    state.lockdownStartedAt = now;
    state.lockdownActive = state.lockdownDuration > 0;
    return true;
  }

  void recordSuccess(const String& areaId) {
    AreaLockdownState* state = find(areaId);
    if (state != nullptr) state->failedAttemptCount = 0;
  }

 private:
  static constexpr size_t kMaxAreas = 6;

  AreaLockdownState* find(const String& areaId) {
    for (AreaLockdownState& state : states_) {
      if (state.areaId == areaId) return &state;
    }
    return nullptr;
  }

  bool hasCapacity() const {
    for (const AreaLockdownState& state : states_) {
      if (state.areaId.length() == 0) return true;
    }
    return false;
  }

  AreaLockdownState* getOrCreate(const String& areaId) {
    AreaLockdownState* existing = find(areaId);
    if (existing != nullptr) return existing;
    for (AreaLockdownState& state : states_) {
      if (state.areaId.length() == 0) {
        state.areaId = areaId;
        return &state;
      }
    }
    return nullptr;
  }

  static void expire(AreaLockdownState& state, uint32_t now) {
    if (state.lockdownActive && static_cast<uint32_t>(now - state.lockdownStartedAt) >= state.lockdownDuration) {
      state.lockdownActive = false;
    }
  }

  uint8_t failureThreshold_;
  uint32_t firstStageMs_;
  uint32_t secondStageMs_;
  AreaLockdownState states_[kMaxAreas] = {};
};
