-- Private service-role-only transaction boundary for credential hash + ciphertext.

create or replace function public.store_credential_material(
  p_credential_id uuid,
  p_warehouse_id uuid,
  p_staff_member_id uuid,
  p_truck_id uuid,
  p_credential_type text,
  p_credential_hash text,
  p_encrypted_value text,
  p_is_active boolean default true
)
returns table (
  id uuid,
  credential_type text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_warehouse_id uuid;
  existing_staff_member_id uuid;
  existing_truck_id uuid;
  existing_type text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized';
  end if;

  if p_credential_type not in ('staff_rfid', 'staff_pin', 'truck_rfid', 'truck_pin') then
    raise exception 'unsupported_credential_type';
  end if;
  if p_credential_hash !~ '^[0-9a-f]{64}$' or btrim(p_encrypted_value) = '' then
    raise exception 'invalid_credential_material';
  end if;
  if p_warehouse_id is null or
     ((p_credential_type in ('staff_rfid', 'staff_pin'))
       and (p_staff_member_id is null or p_truck_id is not null)) or
     ((p_credential_type in ('truck_rfid', 'truck_pin'))
       and (p_truck_id is null or p_staff_member_id is not null)) then
    raise exception 'invalid_credential_owner';
  end if;

  if p_credential_id is null then
    if exists (
      select 1
        from public.access_credentials c
       where c.warehouse_id = p_warehouse_id
         and c.credential_type = p_credential_type
         and (
           (p_staff_member_id is not null and c.staff_member_id = p_staff_member_id)
           or (p_truck_id is not null and c.truck_id = p_truck_id)
         )
    ) then
      raise exception 'credential_already_exists';
    end if;

    insert into public.access_credentials (
      warehouse_id, staff_member_id, truck_id, credential_type,
      credential_hash, is_active
    ) values (
      p_warehouse_id, p_staff_member_id, p_truck_id, p_credential_type,
      lower(p_credential_hash), p_is_active
    )
    returning access_credentials.id, access_credentials.credential_type,
      access_credentials.is_active
    into id, credential_type, is_active;
  else
    select c.warehouse_id, c.staff_member_id, c.truck_id, c.credential_type
      into existing_warehouse_id, existing_staff_member_id,
        existing_truck_id, existing_type
      from public.access_credentials c
     where c.id = p_credential_id
       and c.warehouse_id = p_warehouse_id
       and c.staff_member_id is not distinct from p_staff_member_id
       and c.truck_id is not distinct from p_truck_id
       and c.credential_type = p_credential_type
     for update;

    if existing_type is null then
      raise exception 'credential_not_owned';
    end if;

    update public.access_credentials c
       set credential_hash = lower(p_credential_hash),
           is_active = p_is_active,
           updated_at = now()
     where c.id = p_credential_id
    returning c.id, c.credential_type, c.is_active
      into id, credential_type, is_active;
  end if;

  insert into public.access_credential_values (credential_id, encrypted_value, updated_at)
  values (id, p_encrypted_value, now())
  on conflict (credential_id) do update
    set encrypted_value = excluded.encrypted_value,
        updated_at = now();

  return next;
end;
$$;

revoke all on function public.store_credential_material(uuid, uuid, uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.store_credential_material(uuid, uuid, uuid, uuid, text, text, text, boolean)
  to service_role;
