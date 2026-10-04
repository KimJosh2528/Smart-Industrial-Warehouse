#pragma once

#include <Arduino.h>
#include <cstring>
#include <cstdio>
#include <mbedtls/md.h>

class RequestSigner {
 public:
  // Signs timestamp + "." + exact rawBody with the device-only secret.
  bool signRequest(uint32_t timestamp, const String& rawBody, String& signature,
                  String& reason, const char* deviceSecret) const {
    return signRequest(timestamp,
                       reinterpret_cast<const uint8_t*>(rawBody.c_str()),
                       rawBody.length(), signature, reason, deviceSecret);
  }

  bool signRequest(uint32_t timestamp, const uint8_t* rawBody, size_t rawBodyLength,
                   String& signature, String& reason, const char* deviceSecret) const {
    if (deviceSecret == nullptr || deviceSecret[0] == '\0') {
      signature = "";
      reason = "device_secret_not_configured";
      return false;
    }
    unsigned char digest[32];
    mbedtls_md_context_t context;
    mbedtls_md_init(&context);
    const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    const int setupResult = mbedtls_md_setup(&context, info, 1);
    const int startResult = setupResult == 0 ? mbedtls_md_hmac_starts(
        &context, reinterpret_cast<const unsigned char*>(deviceSecret), strlen(deviceSecret)) : -1;
    const String timestampPrefix = String(timestamp) + ".";
    const int prefixResult = startResult == 0 ? mbedtls_md_hmac_update(
        &context, reinterpret_cast<const unsigned char*>(timestampPrefix.c_str()),
        timestampPrefix.length()) : -1;
    const int bodyResult = prefixResult == 0 && rawBody != nullptr
        ? mbedtls_md_hmac_update(&context, rawBody, rawBodyLength)
        : prefixResult;
    const int finishResult = bodyResult == 0 ? mbedtls_md_hmac_finish(&context, digest) : -1;
    mbedtls_md_free(&context);
    if (finishResult != 0) {
      signature = "";
      reason = "hmac_failed";
      return false;
    }
    signature = "";
    for (size_t index = 0; index < sizeof(digest); ++index) {
      char byteHex[3];
      snprintf(byteHex, sizeof(byteHex), "%02x", digest[index]);
      signature += byteHex;
    }
    reason = "";
    return true;
  }
};
