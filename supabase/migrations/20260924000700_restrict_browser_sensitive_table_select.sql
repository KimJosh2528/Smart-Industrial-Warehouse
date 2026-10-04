-- Replace browser table-wide reads with explicit non-sensitive projections.
-- Server-side service_role table access is intentionally preserved.

revoke select on public.access_credentials from public, anon, authenticated;
revoke select on public.devices from public, anon, authenticated;

grant select (
  id,
  warehouse_id,
  staff_member_id,
  truck_id,
  credential_type,
  is_active,
  created_at,
  updated_at
) on public.access_credentials to anon, authenticated;

grant select (
  id,
  warehouse_id,
  name,
  device_type,
  serial_number,
  is_active,
  capabilities,
  created_at,
  updated_at,
  device_uid,
  last_seen_at,
  environmental_state
) on public.devices to anon, authenticated;
