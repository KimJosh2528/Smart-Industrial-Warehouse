# Phase 18.7 Wokwi security hardware

`diagram.json` is the reusable Device 1 physical prototype for the current
firmware architecture. It is one demonstration unit for a larger logical
warehouse system; it is not a claim that every logical area has a separate
physical controller or door assembly. Phase 18.7-B changes only physical
placement and labels; the electrical connections and GPIO assignments below
are authoritative.

## Logical system versus physical prototype

The logical warehouse contains:

- Truck Entrance
- Staff Entrance
- Staff Room 1
- Staff Room 2
- Staff Room 3
- Staff Room 4

The physical Device 1 prototype contains the available shared controller and
demonstration hardware. Normal demonstrations are performed sequentially, one
logical access function at a time, using that prototype. No runtime device-type
selector or additional physical controller is implied.

## Components

- ESP32 DevKit v1
- MFRC522 RFID reader over SPI
- 4x4 matrix keypad
- DHT22 and MQ2 smoke-sensor substitute
- Three dedicated servos: staff entrance, truck entrance, emergency/fire exit
- One shared I2C LCD1602 system-status display at address `0x27`
- One 74HC595 output expander
- Four access LEDs: staff green/red and truck green/red
- One separate fire/safety red LED
- Buzzer and relay module

## Device 1 physical assignment

- Servo 1 (`servo_staff`): Staff Entrance
- Servo 2 (`servo_truck`): Truck Entrance
- Servo 3 (`servo_fire`): Emergency / Fire Exit
- One RFID reader, keypad, LCD, DHT22, smoke sensor, buzzer, relay, 74HC595,
  access-result LEDs, and safety/emergency LED

The three servos are permanently dedicated prototype outputs. They are not
interchangeable and are not reused between staff and truck demonstrations.

## GPIO and output map

| Function | GPIO or connection |
| --- | --- |
| MFRC522 SCK/MISO/MOSI | 18 / 19 / 23 |
| MFRC522 CS/RST | 5 / 4 |
| Keypad rows | 12 / 13 / 14 / 16 |
| Keypad columns | 17 / 25 / 26 / 27 |
| DHT22 data | 33 |
| MQ2 analog/digital | 34 / 35 (firmware uses analog input) |
| Staff/truck/fire servo PWM | 2 / 15 / 32 |
| Shared LCD SDA/SCL | 21 / 22 |
| Shared LCD I2C address | 0x27 |
| 74HC595 DS/SHCP/STCP | 23 / 18 / 3 |
| 74HC595 Q0-Q4 | staff green, staff red, truck green, truck red, safety red |
| 74HC595 Q5/Q6/Q7 | relay reserved / buzzer / spare |

The 74HC595 data and clock lines share the MFRC522 SPI pins. The firmware
shifts status output state only while the RFID reader chip-select is inactive;
the shift register is not an SPI-selected peripheral. GPIO3 is the latch line,
so it is also the ESP32 UART RX pin; this is acceptable for the Wokwi layout but
is a physical deployment trade-off and may affect serial input.

The relay is physically represented and held reserved by the current logic; no
unapproved actuator behavior is invented. LEDs are driven only as access-result
or fire-state indicators. The LCD displays are state-driven and use the same
I2C bus. The single display is a shared system-status display; staff, truck,
safety, warning, emergency, and lockdown states replace one another
statefully on that display.

## Safety behavior

The backend remains authoritative for NORMAL/WARNING/DANGER environmental state.
The firmware sends DHT22/MQ2 readings, and a DANGER response activates the
emergency coordinator, opens all three dedicated servo slots simultaneously,
enables the safety red LED, activates the emergency buzzer, and shows the
emergency message. Access handling is suppressed while emergency is active and
normal relocking is blocked. This system-wide emergency behavior is distinct
from the sequential normal access demonstrations. No local threshold or fake
camera result is added.

## Limitations

- Servo area UUIDs and device credentials remain private configuration values;
  the checked-in defaults do not authorize access.
- Camera/OCR hardware remains deferred.
- Wokwi CLI is optional; diagram validation and PlatformIO compilation do not
  constitute an end-to-end simulator run.
