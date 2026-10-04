-- Phase 17 Step 1: enforce credential type and owner alignment.
-- The existing exactly-one-owner constraint remains unchanged.

alter table public.access_credentials
  add constraint access_credentials_type_owner_check
  check (
    (
      credential_type in ('staff_rfid', 'staff_pin')
      and staff_member_id is not null
      and truck_id is null
    )
    or (
      credential_type = 'truck_rfid'
      and staff_member_id is null
      and truck_id is not null
    )
  );
