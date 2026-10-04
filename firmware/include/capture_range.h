#pragma once

enum class CaptureRangeDecision {
  Wait,
  Capture,
  Unavailable,
};

class CameraCaptureRangeProvider {
 public:
  virtual ~CameraCaptureRangeProvider() = default;
  virtual CaptureRangeDecision evaluate() = 0;
};

// Replaceable boundary for a software-only visual readiness experiment. It
// intentionally reports unavailable until a real camera analysis is supplied.
class VisualCaptureRangeProvider final : public CameraCaptureRangeProvider {
 public:
  CaptureRangeDecision evaluate() override { return CaptureRangeDecision::Unavailable; }
};

// Reserved replacement boundary if visual readiness proves inadequate.
class DistanceSensorRangeProvider final : public CameraCaptureRangeProvider {
 public:
  CaptureRangeDecision evaluate() override { return CaptureRangeDecision::Unavailable; }
};
