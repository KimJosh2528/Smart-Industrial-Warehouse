# Database architecture

This document describes the Phase 2 relational model. It is intentionally limited
to data architecture. Supabase Auth, Row Level Security, Edge Functions, device
authentication, thresholds, and hardware control belong to later phases.

## Ownership and warehouses

- `profiles` represents future application owners/operators without creating fake accounts.
- `warehouses.owner_id` supports one owner managing multiple warehouses.
- Every operational record belongs to a warehouse directly or through its parent entity.

## Logical areas

`warehouse_area_types` contains the six approved logical locations:

1. Truck Entrance
2. Staff Entrance
3. Staff Room 1
4. Staff Room 2
5. Staff Room 3
6. Staff Room 4

`warehouse_areas` associates those reference types with a particular warehouse and
stores the logical state: `locked`, `unlocked`, or `emergency_release`. These are
logical areas, not six physical servos. The prototype can reuse three physical
servos across demonstrations; the later device-mapping phase will define that
relationship.

## Devices and credentials

`devices` belongs to a warehouse and represents a controller or module capable of
operating multiple hardware components. The schema does not require one row for
each sensor, servo, reader, or LCD.

`staff_members` and `trucks` are separate principals. `access_credentials` stores
only credential hashes, never plaintext PINs or RFID values:

- staff RFID: primary staff credential; Phase 7 represents it as SHA-256 of the
  lowercase, separator-free hexadecimal RFID UID
- staff PIN: backup staff credential; Phase 8 represents it as SHA-256 of the
  canonical digit string
- truck RFID: backup truck credential

Truck plate numbers are stored on `trucks` for later plate-recognition integration.
No OCR or ESP32-CAM implementation is included in this phase.

`access_permissions` is many-to-many between a staff member or truck and a logical
area, so one staff member can access multiple areas.

## Access and safety records

- `access_logs` records successful and denied staff/truck attempts. Unknown or
  denied credentials can be logged without a credential foreign key.
- `sensor_readings` stores temperature, humidity, smoke, and fire observations.
- `safety_events` stores safety conditions and their resolution lifecycle.
- `warehouse_emergency_states` stores the current warehouse-level emergency mode.

Phase 9 adds device-scoped `device_safety_config` thresholds for temperature and
humidity and an optional `sensor_readings.environmental_state` value of
`NORMAL`, `WARNING`, or `DANGER`. Phase 10 adds the nullable generic
`sensor_readings.smoke_value` measurement and optional owner-managed
`smoke_warning_value` / `smoke_danger_value` thresholds. The smoke value is
raw/normalized until the physical model and calibration are confirmed; it is
not ppm. Thresholds are owner-managed and no default values are seeded.
Temperature, humidity, and smoke belong to one `safety_sensor_unit`; no
separate smoke Device is created. Phase 10 does not create safety events or
emergency transitions for every sample.

The combined sensor request is stored as one `sensor_readings` row. DHT22
temperature and humidity remain required for this reading path; smoke remains
nullable for partial hardware availability.

Phase 12 adds the nullable current `devices.environmental_state` and extends
`safety_events` with the previous/current environmental states and the related
`sensor_reading_id`. The server-side `record_sensor_reading` function locks the
Device row, evaluates thresholds, stores the reading, updates the current
state, and creates one `ENVIRONMENTAL_STATE_CHANGED` event only for a real
state change. The first configured reading establishes the state without a
fabricated previous state. This transaction prevents concurrent submissions
from creating duplicate transition events.

No threshold values or automatic emergency triggers are defined yet. When a later
application/service detects smoke or fire, it can record a safety event, set the
warehouse to `emergency_release`, and update the logical area states as one
controlled operation. The database does not directly drive a servo in Phase 2.

Phase 13 does not add a migration or actuator table. Existing access logs and
server authorization remain the source of truth. Physical servo mapping is a
firmware demonstration configuration: three reusable physical slots can
represent the six logical areas sequentially. Environmental `DANGER` state is
not an actuator command.

Phase 14 adds no database objects. Buzzer and LCD feedback is local and
transient; access logs and server-side safety events remain unchanged.

Phase 15 reuses `devices.environmental_state` and the existing
`ENVIRONMENTAL_STATE_CHANGED` event. No duplicate emergency state table or
event system is added. Emergency activation is a firmware response to the
authenticated server state and remains a prototype mechanism; no automatic
reset policy or life-safety compliance claim is made.

Phase 16 does not add tables or alter the protected `trucks.plate_number` and
`trucks.normalized_plate` identity fields. The existing `access_logs` event
vocabulary already contains `TRUCK_PLATE_SUCCESS` and `TRUCK_PLATE_DENIED`,
and the existing `truck_plate` authentication method is reserved for the
future server-side OCR authorization path. No OCR output is stored as a truck
identity, no image storage is added, and no truck records are seeded.

## Migration and seed policy

The migration is deterministic and safe for a fresh database. The only inserted
rows are the six static area-type reference rows. No owner accounts, passwords,
PINs, RFID UIDs, truck credentials, device secrets, or API keys are seeded.

## Authentication and ownership isolation

Phase 3 connects `profiles.id` directly to `auth.users.id`. A database trigger
creates a profile for each newly created Auth user, using only the Auth user's
ID and a display-name value. It does not create a warehouse or credentials.

The ownership path is:

```text
auth.uid()
  -> profiles.id
  -> warehouses.owner_id
  -> warehouse-owned records
```

Row Level Security is enabled on every application table. Warehouse-specific
policies call `is_warehouse_owner(warehouse_id)`, which checks the authenticated
user against the warehouse owner. Reference area types are readable by
authenticated users but are not writable by them.

Owners can manage their own warehouse configuration, areas, devices, staff,
trucks, credentials, and permissions. Access logs, sensor readings, and safety
events are read-only to normal dashboard users in this phase. Emergency state is
also read-only; later controlled services may update operational records.

Registered identity fields are protected by the Phase 8.5 migration:
`staff_members.employee_code`, `trucks.plate_number`,
`trucks.normalized_plate`, and `devices.device_uid` cannot be changed through
ordinary updates. The encrypted device secret and device authentication/replay
fields are not readable or writable by browser roles. Future identity changes
must use a separate administrative process.

Supabase Auth passwords remain inside `auth.users`; application tables contain no
passwords, PINs, plaintext HMAC secrets, API keys, or plaintext device secrets.
Provisioned devices store only encrypted device-secret ciphertext for server-side
verification; it is not exposed to browser or dashboard
code must use only public Supabase configuration. Service-role access and device
authentication are intentionally deferred.
