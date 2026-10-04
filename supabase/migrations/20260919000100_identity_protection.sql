-- Phase 8.5: protect registered identities and device authentication material.
-- No existing identity values are changed and no records are inserted.

create or replace function public.prevent_registered_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'staff_members' then
    if new.employee_code is distinct from old.employee_code then
      raise exception 'registered staff identity is immutable';
    end if;
  end if;

  if tg_table_name = 'trucks' then
    if new.plate_number is distinct from old.plate_number
       or new.normalized_plate is distinct from old.normalized_plate then
      raise exception 'registered truck identity is immutable';
    end if;
  end if;

  if tg_table_name = 'devices' then
    if new.device_uid is distinct from old.device_uid
       or new.device_secret_encrypted is distinct from old.device_secret_encrypted then
      raise exception 'registered device authentication identity is immutable';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_registered_identity_change() from public, anon, authenticated;

drop trigger if exists staff_members_registered_identity_guard on public.staff_members;
create trigger staff_members_registered_identity_guard
  before update on public.staff_members
  for each row execute function public.prevent_registered_identity_change();

drop trigger if exists trucks_registered_identity_guard on public.trucks;
create trigger trucks_registered_identity_guard
  before update on public.trucks
  for each row execute function public.prevent_registered_identity_change();

drop trigger if exists devices_registered_identity_guard on public.devices;
create trigger devices_registered_identity_guard
  before update on public.devices
  for each row execute function public.prevent_registered_identity_change();

-- The encrypted device secret and authentication/replay fields are server-only.
-- Owners may still manage ordinary device metadata through the existing RLS
-- policies, but browser roles cannot read or update these protected columns.
revoke select (device_secret_encrypted) on public.devices from anon, authenticated;
revoke update (device_uid, device_secret_encrypted, last_nonce_ts, last_seen_at)
  on public.devices from anon, authenticated;
