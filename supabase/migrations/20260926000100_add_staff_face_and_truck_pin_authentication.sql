-- Phase 2B: extend the existing credential/access-log vocabulary.
-- No tables, relationships, ownership rules, or RLS policies are changed.

alter table public.access_credentials
  drop constraint access_credentials_type_check;

alter table public.access_credentials
  add constraint access_credentials_type_check
  check (credential_type in ('staff_rfid', 'staff_pin', 'staff_face', 'truck_rfid', 'truck_pin'));

alter table public.access_credentials
  drop constraint access_credentials_type_owner_check;

alter table public.access_credentials
  add constraint access_credentials_type_owner_check
  check (
    (
      credential_type in ('staff_rfid', 'staff_pin', 'staff_face')
      and staff_member_id is not null
      and truck_id is null
    )
    or (
      credential_type in ('truck_rfid', 'truck_pin')
      and staff_member_id is null
      and truck_id is not null
    )
  );

alter table public.access_logs
  drop constraint access_logs_event_type_check;

alter table public.access_logs
  add constraint access_logs_event_type_check
  check (event_type in (
    'STAFF_RFID_SUCCESS', 'STAFF_RFID_DENIED',
    'STAFF_PIN_SUCCESS', 'STAFF_PIN_DENIED',
    'STAFF_FACE_SUCCESS', 'STAFF_FACE_DENIED',
    'TRUCK_PLATE_SUCCESS', 'TRUCK_PLATE_DENIED',
    'TRUCK_RFID_SUCCESS', 'TRUCK_RFID_DENIED',
    'TRUCK_PIN_SUCCESS', 'TRUCK_PIN_DENIED'
  ));

alter table public.access_logs
  drop constraint access_logs_authentication_method_check;

alter table public.access_logs
  add constraint access_logs_authentication_method_check
  check (authentication_method in (
    'staff_rfid', 'staff_pin', 'staff_face',
    'truck_plate', 'truck_rfid', 'truck_pin', 'unknown'
  ));
