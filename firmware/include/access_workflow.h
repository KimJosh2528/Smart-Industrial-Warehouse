#pragma once

#include <Arduino.h>

#include "access_lockdown.h"
#include "api_client.h"
#include "camera.h"
#include "servo_controller.h"

enum class AccessWorkflowKind {
  Staff,
  Truck,
};

enum class AccessWorkflowState {
  Idle,
  CaptureReady,
  CameraAuthentication,
  Authorized,
  CameraFailed,
  RfidAuthentication,
  RfidFailed,
  KeypadAuthentication,
  Denied,
};

enum class AuthenticationOutcome {
  Authorized,
  Failed,
  Unavailable,
  Timeout,
};

enum class AccessInputMethod {
  Camera,
  Rfid,
  Keypad,
};

struct AccessInputEvent {
  AccessWorkflowKind kind = AccessWorkflowKind::Staff;
  AccessInputMethod method = AccessInputMethod::Camera;
  String areaId;
  String credentialHash;
  CameraFrame frame;
};

class AccessInputSource {
 public:
  virtual ~AccessInputSource() = default;
  virtual bool poll(AccessInputEvent& event) = 0;
};

class UnassignedAccessInputSource final : public AccessInputSource {
 public:
  bool poll(AccessInputEvent& event) override {
    event = {};
    return false;
  }
};

// Explicit non-blocking priority state machine. Hardware/provider adapters
// submit outcomes later; no local allowlist or authorization decision exists.
class AuthenticationFallbackController {
 public:
  bool start(AccessWorkflowKind kind, const String& areaId, uint32_t now,
             uint32_t timeoutMs, AccessLockdownManager& lockdown,
             bool emergencyActive) {
    if (emergencyActive || areaId.length() == 0 || !lockdown.canTrack(areaId) ||
        lockdown.isLockedDown(areaId, now)) {
      return false;
    }
    kind_ = kind;
    areaId_ = areaId;
    lockdown_ = &lockdown;
    state_ = AccessWorkflowState::CaptureReady;
    activeTimeoutMs_ = timeoutMs;
    deadline_ = now + timeoutMs;
    return true;
  }

  void service(uint32_t now) {
    if (state_ == AccessWorkflowState::Idle || state_ == AccessWorkflowState::Authorized ||
        state_ == AccessWorkflowState::Denied) return;
    if (state_ == AccessWorkflowState::CaptureReady) {
      state_ = AccessWorkflowState::CameraAuthentication;
      deadline_ = now + activeTimeoutMs_;
      return;
    }
    if (static_cast<int32_t>(now - deadline_) < 0) return;
    if (state_ == AccessWorkflowState::KeypadAuthentication) {
      recordFailure(now);
      state_ = AccessWorkflowState::Denied;
      return;
    }
    handleOutcome(AuthenticationOutcome::Timeout, now, 0, true);
  }

  void submitCameraOutcome(AuthenticationOutcome outcome, uint32_t now, uint32_t timeoutMs) {
    if (state_ != AccessWorkflowState::CameraAuthentication) return;
    handleOutcome(outcome, now, timeoutMs, true);
  }

  void submitRfidOutcome(AuthenticationOutcome outcome, uint32_t now, uint32_t timeoutMs) {
    if (state_ != AccessWorkflowState::RfidAuthentication) return;
    handleOutcome(outcome, now, timeoutMs, true);
  }

  void submitKeypadOutcome(AuthenticationOutcome outcome, uint32_t now) {
    if (state_ != AccessWorkflowState::KeypadAuthentication) return;
    if (outcome == AuthenticationOutcome::Failed || outcome == AuthenticationOutcome::Timeout) {
      recordFailure(now);
    }
    state_ = outcome == AuthenticationOutcome::Authorized
        ? AccessWorkflowState::Authorized : AccessWorkflowState::Denied;
  }

  AccessWorkflowState state() const { return state_; }
  AccessWorkflowKind kind() const { return kind_; }
  const String& areaId() const { return areaId_; }
  void reset() {
    state_ = AccessWorkflowState::Idle;
    areaId_ = "";
    lockdown_ = nullptr;
  }
  bool active() const { return state_ != AccessWorkflowState::Idle &&
      state_ != AccessWorkflowState::Authorized && state_ != AccessWorkflowState::Denied; }

 private:
  void handleOutcome(AuthenticationOutcome outcome, uint32_t now, uint32_t timeoutMs,
                     bool countExplicitFailure) {
    if (outcome == AuthenticationOutcome::Authorized) {
      state_ = AccessWorkflowState::Authorized;
      return;
    }
    if (countExplicitFailure &&
        (outcome == AuthenticationOutcome::Failed || outcome == AuthenticationOutcome::Timeout)) {
      recordFailure(now);
    }
    advanceAfterFailure(now, timeoutMs);
  }

  void recordFailure(uint32_t now) {
    if (lockdown_ != nullptr) lockdown_->recordFailure(areaId_, now);
  }

  void advanceAfterFailure(uint32_t now, uint32_t timeoutMs = 0) {
    const uint32_t nextTimeoutMs = timeoutMs == 0 ? activeTimeoutMs_ : timeoutMs;
    if (state_ == AccessWorkflowState::CaptureReady || state_ == AccessWorkflowState::CameraAuthentication) {
      state_ = AccessWorkflowState::CameraFailed;
      state_ = AccessWorkflowState::RfidAuthentication;
    } else if (state_ == AccessWorkflowState::RfidAuthentication) {
      state_ = AccessWorkflowState::RfidFailed;
      state_ = AccessWorkflowState::KeypadAuthentication;
    } else if (state_ == AccessWorkflowState::KeypadAuthentication) {
      state_ = AccessWorkflowState::Denied;
    }
    if (state_ == AccessWorkflowState::RfidAuthentication || state_ == AccessWorkflowState::KeypadAuthentication) {
      deadline_ = now + nextTimeoutMs;
    }
  }

  AccessWorkflowKind kind_ = AccessWorkflowKind::Staff;
  AccessWorkflowState state_ = AccessWorkflowState::Idle;
  String areaId_;
  AccessLockdownManager* lockdown_ = nullptr;
  uint32_t deadline_ = 0;
  uint32_t activeTimeoutMs_ = 0;
};
