#pragma once

#include "camera.h"

enum class FaceRecognitionResult {
  FaceMatch,
  FaceNoMatch,
  FaceUnavailable,
  FaceTimeout,
};

class FaceRecognitionProvider {
 public:
  virtual ~FaceRecognitionProvider() = default;
  virtual FaceRecognitionResult recognize(const CameraFrame& frame) = 0;
};

class UnassignedFaceRecognition final : public FaceRecognitionProvider {
 public:
  FaceRecognitionResult recognize(const CameraFrame& frame) override {
    (void)frame;
    return FaceRecognitionResult::FaceUnavailable;
  }
};
