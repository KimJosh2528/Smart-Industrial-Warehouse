#pragma once

#include <Arduino.h>
#include <cstdio>
#include <mbedtls/md.h>

struct RfidUid {
  uint8_t bytes[10] = {};
  size_t length = 0;
};

struct RfidScan {
  String credentialHash;
};

class RfidReaderInterface {
 public:
  virtual ~RfidReaderInterface() = default;
  virtual bool begin() = 0;
  virtual bool readUid(RfidUid& uid) = 0;
};

class RfidManager {
 public:
  static constexpr uint32_t kRepeatSuppressionMs = 1500;

  bool begin(RfidReaderInterface& reader) const {
    const bool initialized = reader.begin();
    if (initialized) Serial.println("[RFID] Reader initialized.");
    else Serial.println("[RFID] Reader initialization failed.");
    return initialized;
  }

  bool poll(RfidReaderInterface& reader, RfidScan& scan) {
    RfidUid uid;
    if (!reader.readUid(uid) || uid.length == 0 || uid.length > sizeof(uid.bytes)) return false;

    const String canonical = canonicalUid(uid);
    const String credentialHash = sha256Hex(canonical);
    if (credentialHash.length() != 64) return false;
    const uint32_t now = millis();
    if (credentialHash == lastCredentialHash_ &&
        static_cast<uint32_t>(now - lastScanMillis_) < kRepeatSuppressionMs) {
      return false;
    }

    lastCredentialHash_ = credentialHash;
    lastScanMillis_ = now;
    scan.credentialHash = credentialHash;
    Serial.println("[RFID] Card detected; canonical UID generated.");
    return true;
  }

  static String canonicalUid(const RfidUid& uid) {
    String canonical;
    canonical.reserve(uid.length * 2);
    for (size_t index = 0; index < uid.length; ++index) {
      char byteHex[3];
      snprintf(byteHex, sizeof(byteHex), "%02x", uid.bytes[index]);
      canonical += byteHex;
    }
    return canonical;
  }

 private:
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

  String lastCredentialHash_;
  uint32_t lastScanMillis_ = 0;
};
