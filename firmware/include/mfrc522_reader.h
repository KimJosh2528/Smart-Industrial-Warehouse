#pragma once

#include <Arduino.h>
#include <SPI.h>

#include "config.h"
#include "rfid.h"

// Minimal MFRC522 SPI adapter using the ESP32 Arduino SPI core. It reads card
// UIDs only; authorization remains in the backend and no UID is logged.
class Mfrc522Reader final : public RfidReaderInterface {
 private:
  enum class DiagnosticResult : uint8_t { Rx, Idle, Timer, Error, Timeout };

  struct TransceiveDiagnostics {
    DiagnosticResult result = DiagnosticResult::Timeout;
    uint8_t irq = 0;
    uint8_t error = 0;
    uint8_t fifo = 0;
    uint8_t command = 0;
    uint8_t bitFraming = 0;
    uint8_t txControl = 0;
    uint8_t status2 = 0;
    uint32_t polls = 0;
    uint8_t firstIrq = 0;
    uint8_t data[18] = {};
    size_t dataLength = 0;
  };

 public:
  explicit Mfrc522Reader(const RfidHardwareConfig& config) : config_(config) {}

  bool begin() override {
    if (config_.sckPin < 0 || config_.misoPin < 0 || config_.mosiPin < 0 ||
        config_.chipSelectPin < 0 || config_.resetPin < 0) return false;
    pinMode(config_.chipSelectPin, OUTPUT);
    digitalWrite(config_.chipSelectPin, HIGH);
    pinMode(config_.resetPin, OUTPUT);
    digitalWrite(config_.resetPin, HIGH);
    spi_.begin(config_.sckPin, config_.misoPin, config_.mosiPin, config_.chipSelectPin);
    digitalWrite(config_.resetPin, LOW);
    delay(2);
    digitalWrite(config_.resetPin, HIGH);
    writeRegister(kCommandReg, kSoftReset);
    uint8_t resetWaits = 0;
    do {
      delay(50);
    } while ((readRegister(kCommandReg) & 0x10) != 0 && ++resetWaits < 3);
    writeRegister(kTxModeReg, 0x00);
    writeRegister(kRxModeReg, 0x00);
    writeRegister(kModWidthReg, 0x26);
    writeRegister(kTModeReg, 0x80);
    writeRegister(kTPrescalerReg, 0xA9);
    writeRegister(kTReloadRegH, 0x03);
    writeRegister(kTReloadRegL, 0xE8);
  writeRegister(kTxASKReg, 0x40);
  writeRegister(kModeReg, 0x3D);
  antennaOn();
  Serial.printf("[RFID-RF] POST_ANTENNA TXCONTROL=0x%02X\n",
                readRegister(kTxControlReg));
  Serial.printf("[RFID-RF] TIMER TMODE=0x%02X TPRESCALER=0x%02X "
                "TRELOADH=0x%02X TRELOADL=0x%02X\n",
                readRegister(kTModeReg), readRegister(kTPrescalerReg),
                readRegister(kTReloadRegH), readRegister(kTReloadRegL));
  const uint8_t value = readRegister(kVersionReg);
  Serial.printf("[RFID] Version register raw value: 0x%02X\n", value);
  if (value == 0x00 || value == 0xFF) return false;
  registerDiagnosticsPassed_ = runRegisterReadbackDiagnostics();
  return registerDiagnosticsPassed_;
}

  bool readUid(RfidUid& uid) override {
    if (!registerDiagnosticsPassed_) return false;

    if (cardPresent_) {
      uint8_t wakeRequest[1] = {kWakeupIdle};
      uint8_t wakeResponse[18] = {};
      size_t wakeResponseLength = sizeof(wakeResponse);
      uint8_t wakeValidBits = 7;
      writeRegister(kCollReg, static_cast<uint8_t>(readRegister(kCollReg) & ~0x80));
      const bool wakeOk = transceive(wakeRequest, 1, wakeResponse, wakeResponseLength,
                                     wakeValidBits);
      if (wakeOk && wakeResponseLength >= 2) {
        haltCard();
        return false;
      }
      cardPresent_ = false;
      Serial.println("[RFID] CARD STATE=ABSENT");
      Serial.println("[RFID] RE-ARMED");
      return false;
    }

    uid = {};
    uint8_t request[1] = {kRequestIdle};
    uint8_t response[18] = {};
    size_t responseLength = sizeof(response);
    uint8_t validBits = 7;
    writeRegister(kCollReg, static_cast<uint8_t>(readRegister(kCollReg) & ~0x80));
    TransceiveDiagnostics reqaDiagnostics;
    const bool reqaOk = transceive(request, 1, response, responseLength, validBits,
                                   &reqaDiagnostics);
    emitDiagnostics(reqaDiagnostics);
    if (!reqaOk) return false;

    uint8_t anticollision[2] = {kCascadeLevel1, 0x20};
    responseLength = sizeof(response);
    validBits = 0;
    const bool anticollisionOk =
        transceive(anticollision, 2, response, responseLength, validBits);
    const size_t returnedLength = anticollisionOk ? responseLength : 0;
    Serial.printf("[RFID-DIAG] ANTICOLLISION RESULT=%s\n",
                  anticollisionOk ? "RX" : "FAIL");
    Serial.printf("[RFID-DIAG] ANTICOLLISION LENGTH=%u\n",
                  static_cast<unsigned>(returnedLength));
    Serial.print("[RFID-DIAG] ANTICOLLISION DATA=");
    for (size_t index = 0; index < returnedLength; ++index) {
      if (index != 0) Serial.print(" ");
      Serial.printf("%02X", response[index]);
    }
    Serial.println();
    if (returnedLength >= 5) {
      Serial.printf("[RFID-DIAG] ANTICOLLISION BCC=0x%02X\n", response[4]);
    } else {
      Serial.println("[RFID-DIAG] ANTICOLLISION BCC=UNAVAILABLE");
    }
    if (!anticollisionOk || responseLength < 5) {
      return false;
    }
    const uint8_t bcc = static_cast<uint8_t>(response[0] ^ response[1] ^
                                              response[2] ^ response[3]);
    if (bcc != response[4]) return false;
    for (size_t index = 0; index < 4 && uid.length < sizeof(uid.bytes); ++index) {
      uid.bytes[uid.length++] = response[index];
    }

    uint8_t selectCommand[9] = {kCascadeLevel1, kSelectCommand, response[0], response[1],
                                response[2], response[3], response[4], 0, 0};
    crcA(selectCommand, 7, selectCommand[7], selectCommand[8]);
    uint8_t selectResponse[18] = {};
    size_t selectResponseLength = sizeof(selectResponse);
    uint8_t selectValidBits = 0;
    writeRegister(kCollReg, static_cast<uint8_t>(readRegister(kCollReg) & ~0x80));
    const bool selectOk = transceive(selectCommand, sizeof(selectCommand), selectResponse,
                                      selectResponseLength, selectValidBits);
    Serial.printf("[RFID] SELECT RESULT=%s\n", selectOk ? "RX" : "FAIL");
    if (!selectOk || selectResponseLength < 3) return false;

    uint8_t selectCrcLow = 0;
    uint8_t selectCrcHigh = 0;
    crcA(selectResponse, 1, selectCrcLow, selectCrcHigh);
    if (selectResponse[1] != selectCrcLow || selectResponse[2] != selectCrcHigh) return false;
    Serial.printf("[RFID] SAK=0x%02X\n", selectResponse[0]);
    if ((selectResponse[0] & 0x04) != 0) return false;

    haltCard();
    cardPresent_ = true;
    Serial.println("[RFID] CARD STATE=PRESENT");
    return uid.length > 0;
  }

 private:
  static constexpr uint8_t kCommandReg = 0x01;
  static constexpr uint8_t kComIEnReg = 0x02;
  static constexpr uint8_t kComIrqReg = 0x04;
  static constexpr uint8_t kErrorReg = 0x06;
  static constexpr uint8_t kStatus2Reg = 0x08;
  static constexpr uint8_t kFIFODataReg = 0x09;
  static constexpr uint8_t kFIFOLevelReg = 0x0A;
  static constexpr uint8_t kControlReg = 0x0C;
  static constexpr uint8_t kBitFramingReg = 0x0D;
  static constexpr uint8_t kCollReg = 0x0E;
  static constexpr uint8_t kTxControlReg = 0x14;
  static constexpr uint8_t kTxASKReg = 0x15;
  static constexpr uint8_t kModeReg = 0x11;
  static constexpr uint8_t kTxModeReg = 0x12;
  static constexpr uint8_t kRxModeReg = 0x13;
  static constexpr uint8_t kModWidthReg = 0x24;
  static constexpr uint8_t kTModeReg = 0x2A;
  static constexpr uint8_t kTPrescalerReg = 0x2B;
  static constexpr uint8_t kTReloadRegH = 0x2C;
  static constexpr uint8_t kTReloadRegL = 0x2D;
  static constexpr uint8_t kVersionReg = 0x37;
  static constexpr uint8_t kSoftReset = 0x0F;
  static constexpr uint8_t kTransceive = 0x0C;
  static constexpr uint8_t kRequestIdle = 0x26;
  static constexpr uint8_t kWakeupIdle = 0x52;
  static constexpr uint8_t kSelectCommand = 0x70;
  static constexpr uint8_t kHaltCommand = 0x50;
  static constexpr uint8_t kCascadeLevel1 = 0x93;
  static constexpr uint32_t kTransceiveTimeoutMs = 20;
  uint8_t lastReqaDiagnosticResult_ = 0xFF;
  bool registerDiagnosticsPassed_ = false;
  bool transmitStartDiagnosticsPrinted_ = false;
  bool cardPresent_ = false;

  static void crcA(const uint8_t* data, size_t length, uint8_t& low, uint8_t& high) {
    uint16_t crc = 0x6363;
    for (size_t index = 0; index < length; ++index) {
      uint8_t value = static_cast<uint8_t>(data[index] ^ (crc & 0xFF));
      value ^= static_cast<uint8_t>(value << 4);
      crc = static_cast<uint16_t>((crc >> 8) ^ (static_cast<uint16_t>(value) << 8) ^
                                   (static_cast<uint16_t>(value) << 3) ^ (value >> 4));
    }
    low = static_cast<uint8_t>(crc & 0xFF);
    high = static_cast<uint8_t>(crc >> 8);
  }

  void haltCard() {
    uint8_t haltCommand[4] = {kHaltCommand, 0x00, 0, 0};
    crcA(haltCommand, 2, haltCommand[2], haltCommand[3]);
    uint8_t response[18] = {};
    size_t responseLength = sizeof(response);
    uint8_t validBits = 0;
    transceive(haltCommand, sizeof(haltCommand), response, responseLength, validBits);
  }

  uint8_t readRegister(uint8_t address) {
    SPISettings settings(4000000, MSBFIRST, SPI_MODE0);
    spi_.beginTransaction(settings);
    digitalWrite(config_.chipSelectPin, LOW);
    spi_.transfer(static_cast<uint8_t>(((address << 1) & 0x7E) | 0x80));
    const uint8_t value = spi_.transfer(0x00);
    digitalWrite(config_.chipSelectPin, HIGH);
    spi_.endTransaction();
    return value;
  }

  void writeRegister(uint8_t address, uint8_t value) {
    SPISettings settings(4000000, MSBFIRST, SPI_MODE0);
    spi_.beginTransaction(settings);
    digitalWrite(config_.chipSelectPin, LOW);
    spi_.transfer(static_cast<uint8_t>((address << 1) & 0x7E));
    spi_.transfer(value);
    digitalWrite(config_.chipSelectPin, HIGH);
    spi_.endTransaction();
  }

  void antennaOn() {
    if ((readRegister(kTxControlReg) & 0x03) != 0x03) {
      writeRegister(kTxControlReg, static_cast<uint8_t>(readRegister(kTxControlReg) | 0x03));
    }
  }

  bool readRegisterStable(uint8_t address, uint8_t& value) {
    const uint8_t first = readRegister(address);
    const uint8_t second = readRegister(address);
    if (first != second) return false;
    value = first;
    return true;
  }

  bool testRegisterReadback(const char* name, uint8_t address, uint8_t temporaryValue) {
    uint8_t originalValue = 0;
    uint8_t temporaryReadback = 0;
    uint8_t restoredReadback = 0;
    const bool originalAvailable = readRegisterStable(address, originalValue);
    if (!originalAvailable) {
      Serial.printf("[RFID-REG] %s addr=0x%02X original=NA write=0x%02X "
                    "readback=NA restored=NA restored_read=NA RESULT=FAIL\n",
                    name, address, temporaryValue);
      return false;
    }

    writeRegister(address, temporaryValue);
    const bool temporaryAvailable = readRegisterStable(address, temporaryReadback);

    writeRegister(address, originalValue);
    const bool restoredAvailable = readRegisterStable(address, restoredReadback);
    const bool passed = temporaryAvailable && restoredAvailable &&
                        temporaryReadback == temporaryValue &&
                        restoredReadback == originalValue;
    if (temporaryAvailable && restoredAvailable) {
      Serial.printf("[RFID-REG] %s addr=0x%02X original=0x%02X write=0x%02X "
                    "readback=0x%02X restored=0x%02X restored_read=0x%02X RESULT=%s\n",
                    name, address, originalValue, temporaryValue, temporaryReadback,
                    originalValue, restoredReadback, passed ? "PASS" : "FAIL");
    } else {
      Serial.printf("[RFID-REG] %s addr=0x%02X original=0x%02X write=0x%02X "
                    "readback=%s restored=0x%02X restored_read=%s RESULT=FAIL\n",
                    name, address, originalValue, temporaryValue,
                    temporaryAvailable ? "UNEXPECTED" : "NA", originalValue,
                    restoredAvailable ? "UNEXPECTED" : "NA");
    }
    return passed;
  }

  bool runRegisterReadbackDiagnostics() {
    const bool bitFramingPassed = testRegisterReadback("BitFramingReg", kBitFramingReg, 0x07);
    const bool reloadLowPassed = testRegisterReadback("TReloadRegL", kTReloadRegL, 0x1F);
    const bool reloadHighPassed = testRegisterReadback("TReloadRegH", kTReloadRegH, 0x01);
    return bitFramingPassed && reloadLowPassed && reloadHighPassed;
  }

  static const char* diagnosticResultName(DiagnosticResult result) {
    switch (result) {
      case DiagnosticResult::Rx: return "RX";
      case DiagnosticResult::Idle: return "IDLE";
      case DiagnosticResult::Timer: return "TIMER";
      case DiagnosticResult::Error: return "ERROR";
      case DiagnosticResult::Timeout: return "TIMEOUT";
    }
    return "ERROR";
  }

  void captureDiagnostics(TransceiveDiagnostics* diagnostics) {
    if (diagnostics == nullptr) return;
    diagnostics->irq = readRegister(kComIrqReg);
    diagnostics->error = readRegister(kErrorReg);
    diagnostics->fifo = readRegister(kFIFOLevelReg);
    diagnostics->command = readRegister(kCommandReg);
    diagnostics->bitFraming = readRegister(kBitFramingReg);
    diagnostics->txControl = readRegister(kTxControlReg);
    diagnostics->status2 = readRegister(kStatus2Reg);
  }

  void emitDiagnostics(const TransceiveDiagnostics& diagnostics) {
    const uint8_t result = static_cast<uint8_t>(diagnostics.result);
    if (result == lastReqaDiagnosticResult_) return;
    lastReqaDiagnosticResult_ = result;

    Serial.printf("[RFID-DIAG] REQA RESULT=%s\n",
                  diagnosticResultName(diagnostics.result));
    Serial.printf("[RFID-DIAG] REQA IRQ=0x%02X\n", diagnostics.irq);
    Serial.printf("[RFID-DIAG] REQA ERROR=0x%02X\n", diagnostics.error);
    Serial.printf("[RFID-DIAG] REQA FIFO=%u\n", diagnostics.fifo);
    Serial.printf("[RFID-DIAG] REQA COMMAND=0x%02X\n", diagnostics.command);
    Serial.printf("[RFID-DIAG] REQA BITFRAMING=0x%02X\n", diagnostics.bitFraming);
    Serial.printf("[RFID-DIAG] REQA TXCONTROL=0x%02X\n", diagnostics.txControl);
    Serial.printf("[RFID-DIAG] REQA STATUS2=0x%02X\n", diagnostics.status2);
    Serial.printf("[RFID-DIAG] REQA POLLS=%lu\n",
                  static_cast<unsigned long>(diagnostics.polls));
    Serial.printf("[RFID-RF] FIRST_IRQ=0x%02X\n", diagnostics.firstIrq);
    Serial.print("[RFID-DIAG] REQA DATA=");
    for (size_t index = 0; index < diagnostics.dataLength; ++index) {
      Serial.printf("%02X", diagnostics.data[index]);
    }
    Serial.println();
  }

  bool transceive(const uint8_t* input, size_t inputLength, uint8_t* output,
                  size_t& outputLength, uint8_t validBits,
                  TransceiveDiagnostics* diagnostics = nullptr) {
    writeRegister(kCommandReg, 0x00);
    writeRegister(kComIrqReg, 0x7F);
    writeRegister(kFIFOLevelReg, 0x80);
    for (size_t index = 0; index < inputLength; ++index) writeRegister(kFIFODataReg, input[index]);
    writeRegister(kBitFramingReg, validBits);
    writeRegister(kCommandReg, kTransceive);
    // Immediate POST_COMMAND diagnostic read disabled for isolation.
    writeRegister(kBitFramingReg, static_cast<uint8_t>(validBits | 0x80));
    // Immediate POST_STARTSEND diagnostic read disabled for isolation.

    const uint32_t deadline = millis() + kTransceiveTimeoutMs;
    bool completed = false;
    while (static_cast<int32_t>(millis() - deadline) < 0) {
      const uint8_t irq = readRegister(kComIrqReg);
      if (diagnostics != nullptr) {
        diagnostics->irq = irq;
        ++diagnostics->polls;
        if (irq != 0 && diagnostics->firstIrq == 0) diagnostics->firstIrq = irq;
      }
      if ((irq & 0x30) != 0) {
        completed = true;
        if (diagnostics != nullptr) {
          diagnostics->result = (irq & 0x20) != 0
              ? DiagnosticResult::Rx
              : DiagnosticResult::Idle;
        }
        break;
      }
      if ((irq & 0x03) != 0) {
        if (diagnostics != nullptr) {
          diagnostics->result = (irq & 0x02) != 0
              ? DiagnosticResult::Error
              : DiagnosticResult::Timer;
          captureDiagnostics(diagnostics);
        }
        return false;
      }
    }
    if (!completed) {
      if (diagnostics != nullptr) {
        diagnostics->result = DiagnosticResult::Timeout;
        captureDiagnostics(diagnostics);
      }
      return false;
    }
    writeRegister(kBitFramingReg, 0x00);
    const uint8_t error = readRegister(kErrorReg);
    if ((error & 0x1B) != 0) {
      if (diagnostics != nullptr) {
        diagnostics->result = DiagnosticResult::Error;
        captureDiagnostics(diagnostics);
      }
      return false;
    }

    const size_t available = readRegister(kFIFOLevelReg);
    if (available == 0 || available > outputLength) {
      if (diagnostics != nullptr) {
        diagnostics->fifo = static_cast<uint8_t>(available);
        diagnostics->result = DiagnosticResult::Error;
        captureDiagnostics(diagnostics);
      }
      return false;
    }
    outputLength = available;
    for (size_t index = 0; index < outputLength; ++index) {
      output[index] = readRegister(kFIFODataReg);
      if (diagnostics != nullptr) diagnostics->data[index] = output[index];
    }
    if (diagnostics != nullptr) {
      diagnostics->fifo = static_cast<uint8_t>(available);
      diagnostics->dataLength = outputLength;
      captureDiagnostics(diagnostics);
    }
    return true;
  }

  const RfidHardwareConfig& config_;
  SPIClass& spi_ = SPI;
};
