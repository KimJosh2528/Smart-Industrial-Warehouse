#pragma once

#include <Arduino.h>
#include <cstring>

#include "capture_range.h"

enum class CameraWorkflowKind {
  StaffFaceRecognition,
  TruckPlateRecognition,
  FutureCaptureRangeValidation,
};

enum class CameraCaptureStatus {
  WaitingForRange,
  Unavailable,
  Failed,
  Succeeded,
};

struct CameraFrame {
  const uint8_t* bytes = nullptr;
  size_t length = 0;
  const char* contentType = nullptr;
};

// Model-neutral boundary. A confirmed ESP32-CAM board and its GPIO/library
// adapter must be supplied before this interface can produce image bytes.
class CameraDriverInterface {
 public:
  virtual ~CameraDriverInterface() = default;
  virtual bool begin() = 0;
  virtual bool captureFrame(CameraFrame& frame) = 0;
  virtual void releaseFrame(CameraFrame& frame) = 0;
};

class UnassignedCameraDriver final : public CameraDriverInterface {
 public:
  bool begin() override { return false; }

  bool captureFrame(CameraFrame& frame) override {
    frame = {};
    return false;
  }

  void releaseFrame(CameraFrame& frame) override { frame = {}; }
};

class CameraCaptureController {
 public:
  bool begin(CameraDriverInterface& driver) {
    driver_ = &driver;
    available_ = driver_->begin();
    status_ = available_ ? CameraCaptureStatus::Failed : CameraCaptureStatus::Unavailable;
    if (available_) Serial.println("[CAMERA] Camera initialized.");
    else Serial.println("[CAMERA] Camera unavailable; capture disabled.");
    return available_;
  }

  CameraCaptureStatus capture(CameraFrame& frame) {
    frame = {};
    if (driver_ == nullptr || !available_) {
      status_ = CameraCaptureStatus::Unavailable;
      return status_;
    }
    if (!driver_->captureFrame(frame) || frame.bytes == nullptr || frame.length == 0 ||
        frame.contentType == nullptr || strcmp(frame.contentType, "image/jpeg") != 0) {
      driver_->releaseFrame(frame);
      frame = {};
      status_ = CameraCaptureStatus::Failed;
      return status_;
    }
    status_ = CameraCaptureStatus::Succeeded;
    return status_;
  }

  CameraCaptureStatus captureForWorkflow(CameraWorkflowKind workflow,
                                         CameraCaptureRangeProvider& rangeProvider,
                                         CameraFrame& frame) {
    workflow_ = workflow;
    const CaptureRangeDecision range = rangeProvider.evaluate();
    if (range == CaptureRangeDecision::Wait) {
      frame = {};
      status_ = CameraCaptureStatus::WaitingForRange;
      return status_;
    }
    if (range != CaptureRangeDecision::Capture) {
      frame = {};
      status_ = CameraCaptureStatus::Unavailable;
      return status_;
    }
    return capture(frame);
  }

  void release(CameraFrame& frame) {
    if (driver_ != nullptr) driver_->releaseFrame(frame);
    frame = {};
  }

  CameraCaptureStatus status() const { return status_; }
  bool available() const { return available_; }
  CameraWorkflowKind workflow() const { return workflow_; }

 private:
  CameraDriverInterface* driver_ = nullptr;
  CameraCaptureStatus status_ = CameraCaptureStatus::Unavailable;
  bool available_ = false;
  CameraWorkflowKind workflow_ = CameraWorkflowKind::FutureCaptureRangeValidation;
};
