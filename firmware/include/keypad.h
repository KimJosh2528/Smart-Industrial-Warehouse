#pragma once

#include <Arduino.h>
#include <cstdio>
#include <mbedtls/md.h>

struct KeypadInputConfig {
  size_t minimumPinLength = 4;
  size_t maximumPinLength = 6;
  uint32_t inputTimeoutMs = 15000;
  char confirmKey = '#';
  char clearKey = '*';
  char cancelKey = 'C';

  KeypadInputConfig() = default;
  KeypadInputConfig(size_t minimumLength, size_t maximumLength, uint32_t timeoutMs,
                    char confirm, char clear, char cancel)
      : minimumPinLength(minimumLength), maximumPinLength(maximumLength),
        inputTimeoutMs(timeoutMs), confirmKey(confirm), clearKey(clear), cancelKey(cancel) {}
};

struct KeypadSubmission {
  String credentialHash;
};

enum class KeypadEvent {
  None,
  DigitCollected,
  Submitted,
  Cleared,
  Cancelled,
  TimedOut,
  InvalidSubmission,
};

class KeypadReaderInterface {
 public:
  virtual ~KeypadReaderInterface() = default;
  virtual bool begin() = 0;
  virtual bool readKey(char& key) = 0;
};

class KeypadManager {
 public:
  explicit KeypadManager(const KeypadInputConfig& config) : config_(config) {}

  bool begin(KeypadReaderInterface& reader) const {
    const bool initialized = reader.begin();
    if (initialized) Serial.println("[KEYPAD] Reader initialized.");
    else Serial.println("[KEYPAD] Reader initialization failed.");
    return initialized;
  }

  KeypadEvent poll(KeypadReaderInterface& reader, KeypadSubmission& submission) {
    submission.credentialHash = "";
    const uint32_t now = millis();

    if (hasInput_ && static_cast<uint32_t>(now - lastInputMillis_) >= config_.inputTimeoutMs) {
      clearInput();
      return KeypadEvent::TimedOut;
    }

    char key = '\0';
    if (!reader.readKey(key)) return KeypadEvent::None;
    if (key == lastKey_ && static_cast<uint32_t>(now - lastKeyMillis_) < 75) return KeypadEvent::None;
    lastKey_ = key;
    lastKeyMillis_ = now;

    if (key == config_.clearKey) {
      clearInput();
      return KeypadEvent::Cleared;
    }
    if (key == config_.cancelKey) {
      clearInput();
      return KeypadEvent::Cancelled;
    }
    if (key == config_.confirmKey) {
      if (!hasInput_ || pin_.length() < config_.minimumPinLength) {
        clearInput();
        return KeypadEvent::InvalidSubmission;
      }
      submission.credentialHash = sha256Hex(pin_);
      clearInput();
      return submission.credentialHash.length() == 64
          ? KeypadEvent::Submitted
          : KeypadEvent::InvalidSubmission;
    }
    if (key < '0' || key > '9') return KeypadEvent::None;
    if (pin_.length() >= config_.maximumPinLength) return KeypadEvent::InvalidSubmission;

    pin_ += key;
    hasInput_ = true;
    lastInputMillis_ = now;
    return KeypadEvent::DigitCollected;
  }

 private:
  void clearInput() {
    for (size_t index = 0; index < pin_.length(); ++index) pin_.setCharAt(index, '\0');
    pin_ = "";
    hasInput_ = false;
    lastInputMillis_ = 0;
  }

  static String sha256Hex(const String& value) {
    unsigned char digest[32];
    mbedtls_md_context_t context;
    mbedtls_md_init(&context);
    const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    const int setupResult = mbedtls_md_setup(&context, info, 0);
    const int startResult = setupResult == 0 ? mbedtls_md_starts(&context) : -1;
    const int updateResult = startResult == 0
        ? mbedtls_md_update(&context, reinterpret_cast<const unsigned char*>(value.c_str()), value.length())
        : -1;
    const int finishResult = updateResult == 0 ? mbedtls_md_finish(&context, digest) : -1;
    mbedtls_md_free(&context);

    if (finishResult != 0) return "";
    String hash;
    hash.reserve(sizeof(digest) * 2);
    for (size_t index = 0; index < sizeof(digest); ++index) {
      char byteHex[3];
      snprintf(byteHex, sizeof(byteHex), "%02x", digest[index]);
      hash += byteHex;
    }
    return hash;
  }

  const KeypadInputConfig& config_;
  String pin_;
  bool hasInput_ = false;
  uint32_t lastInputMillis_ = 0;
  char lastKey_ = '\0';
  uint32_t lastKeyMillis_ = 0;
};
