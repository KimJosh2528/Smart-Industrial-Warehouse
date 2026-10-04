-- Prevent browser roles from reading credential hashes and encrypted device secrets.
-- Server-side authentication and provisioning retain service_role access.

create or replace function public.manage_staff_credential(
  p_staff_member_id uuid,
  p_credential_type text,
  p_raw_credential text,
  p_credential_id uuid default null,
  p_is_active boolean default true
)
returns table (
  id uuid,
  staff_member_id uuid,
  credential_type text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  staff_warehouse_id uuid;
  canonical_credential text;
  hashed_credential text;
  existing_staff_id uuid;
  existing_type text;
begin
  if p_credential_type not in ('staff_rfid', 'staff_pin') then
    raise exception 'invalid_staff_credential_type';
  end if;

  select s.warehouse_id
    into staff_warehouse_id
    from public.staff_members s
   where s.id = p_staff_member_id
     and public.is_warehouse_owner(s.warehouse_id)
   for update;

  if staff_warehouse_id is null then
    raise exception 'staff_member_not_owned';
  end if;

  if p_raw_credential is null or btrim(p_raw_credential) = '' then
    raise exception 'credential_required';
  end if;

  if p_credential_type = 'staff_rfid' then
    canonical_credential := lower(btrim(p_raw_credential));
    if canonical_credential !~ '^[0-9a-f]+$'
       or length(canonical_credential) % 2 <> 0 then
      raise exception 'invalid_staff_rfid';
    end if;
  else
    canonical_credential := btrim(p_raw_credential);
    if canonical_credential !~ '^[0-9]+$'
       or length(canonical_credential) < 4
       or length(canonical_credential) > 6 then
      raise exception 'invalid_staff_pin';
    end if;
  end if;

  hashed_credential := encode(
    extensions.digest(convert_to(canonical_credential, 'UTF8'), 'sha256'),
    'hex'
  );

  if p_credential_id is not null then
    select c.staff_member_id, c.credential_type
      into existing_staff_id, existing_type
      from public.access_credentials c
     where c.id = p_credential_id
       and c.staff_member_id = p_staff_member_id
       and c.truck_id is null
       and c.credential_type in ('staff_rfid', 'staff_pin')
       and public.is_warehouse_owner(c.warehouse_id)
     for update;

    if existing_staff_id is null then
      raise exception 'staff_credential_not_owned';
    end if;
    if existing_type <> p_credential_type then
      raise exception 'credential_type_immutable';
    end if;
  end if;

  if exists (
    select 1
      from public.access_credentials c
     where c.warehouse_id = staff_warehouse_id
       and c.credential_type = p_credential_type
       and c.credential_hash = hashed_credential
       and c.id is distinct from p_credential_id
  ) then
    raise exception 'credential_already_exists';
  end if;

  if p_credential_id is null then
    return query
    insert into public.access_credentials (
      warehouse_id, staff_member_id, truck_id, credential_type,
      credential_hash, is_active
    ) values (
      staff_warehouse_id, p_staff_member_id, null, p_credential_type,
      hashed_credential, p_is_active
    )
    returning access_credentials.id,
      access_credentials.staff_member_id,
      access_credentials.credential_type,
      access_credentials.is_active,
      access_credentials.created_at,
      access_credentials.updated_at;
  else
    return query
    update public.access_credentials c
       set credential_hash = hashed_credential,
           is_active = p_is_active,
           updated_at = now()
     where c.id = p_credential_id
     returning c.id, c.staff_member_id, c.credential_type,
       c.is_active, c.created_at, c.updated_at;
  end if;
end;
$$;

create or replace function public.list_truck_credentials()
returns table (
  id uuid,
  truck_id uuid,
  credential_type text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select c.id, c.truck_id, c.credential_type, c.is_active,
         c.created_at, c.updated_at
    from public.access_credentials c
    join public.trucks t on t.id = c.truck_id
   where c.truck_id is not null
     and c.staff_member_id is null
     and c.credential_type = 'truck_rfid'
   order by c.created_at, c.id;
$$;

revoke select (credential_hash) on public.access_credentials from anon, authenticated;
revoke select (device_secret_encrypted) on public.devices from anon, authenticated;

revoke all on function public.list_truck_credentials() from public, anon;
grant execute on function public.list_truck_credentials() to authenticated;

revoke all on function public.manage_staff_credential(uuid, text, text, uuid, boolean)
  from public, anon;
grant execute on function public.manage_staff_credential(uuid, text, text, uuid, boolean)
  to authenticated;
