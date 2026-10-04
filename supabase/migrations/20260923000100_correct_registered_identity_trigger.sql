-- Corrective migration: guard table-specific trigger record fields.
-- This replaces only the existing trigger function; triggers and tables remain unchanged.

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
