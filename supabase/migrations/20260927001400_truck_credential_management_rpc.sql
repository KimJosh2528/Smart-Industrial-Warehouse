-- Truck RFID/PIN management with warehouse-scoped authorization.

create unique index access_credentials_one_truck_type_idx
  on public.access_credentials(truck_id, credential_type)
  where truck_id is not null;

create or replace function public.manage_truck_credential(
  p_truck_id uuid,
  p_credential_type text,
  p_raw_credential text,
  p_credential_id uuid default null,
  p_is_active boolean default true
)
returns table (
  id uuid,
  truck_id uuid,
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
  truck_warehouse_id uuid;
  canonical_credential text;
  hashed_credential text;
  existing_truck_id uuid;
  existing_type text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_credential_type not in ('truck_rfid', 'truck_pin') then
    raise exception 'invalid_truck_credential_type';
  end if;

  select t.warehouse_id
    into truck_warehouse_id
    from public.trucks t
   where t.id = p_truck_id
     and public.is_warehouse_owner(t.warehouse_id)
   for update;

  if truck_warehouse_id is null then
    raise exception 'truck_not_owned';
  end if;

  if p_raw_credential is null or btrim(p_raw_credential) = '' then
    raise exception 'credential_required';
  end if;

  if p_credential_type = 'truck_rfid' then
    canonical_credential := lower(btrim(p_raw_credential));
    if canonical_credential !~ '^[0-9a-f]+$'
       or length(canonical_credential) % 2 <> 0 then
      raise exception 'invalid_truck_rfid';
    end if;
  else
    canonical_credential := btrim(p_raw_credential);
    if canonical_credential !~ '^[0-9]+$'
       or length(canonical_credential) < 4
       or length(canonical_credential) > 6 then
      raise exception 'invalid_truck_pin';
    end if;
  end if;

  hashed_credential := encode(
    extensions.digest(convert_to(canonical_credential, 'UTF8'), 'sha256'),
    'hex'
  );

  if p_credential_id is null then
    if exists (
      select 1
        from public.access_credentials c
       where c.truck_id = p_truck_id
         and c.credential_type = p_credential_type
    ) then
      raise exception 'truck_credential_already_exists';
    end if;

    return query
    insert into public.access_credentials (
      warehouse_id, staff_member_id, truck_id, credential_type,
      credential_hash, is_active
    ) values (
      truck_warehouse_id, null, p_truck_id, p_credential_type,
      hashed_credential, p_is_active
    )
    returning access_credentials.id,
      access_credentials.truck_id,
      access_credentials.credential_type,
      access_credentials.is_active,
      access_credentials.created_at,
      access_credentials.updated_at;
    return;
  end if;

  select c.truck_id, c.credential_type
    into existing_truck_id, existing_type
    from public.access_credentials c
   where c.id = p_credential_id
     and c.truck_id = p_truck_id
     and c.staff_member_id is null
     and c.credential_type in ('truck_rfid', 'truck_pin')
     and public.is_warehouse_owner(c.warehouse_id)
   for update;

  if existing_truck_id is null then
    raise exception 'truck_credential_not_owned';
  end if;
  if existing_type <> p_credential_type then
    raise exception 'credential_type_immutable';
  end if;

  return query
  update public.access_credentials c
     set credential_hash = hashed_credential,
         is_active = p_is_active,
         updated_at = now()
   where c.id = p_credential_id
  returning c.id, c.truck_id, c.credential_type,
    c.is_active, c.created_at, c.updated_at;
end;
$$;

create or replace function public.set_truck_credential_active(
  p_truck_id uuid,
  p_credential_id uuid,
  p_credential_type text,
  p_is_active boolean
)
returns table (
  id uuid,
  truck_id uuid,
  credential_type text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_credential_type not in ('truck_rfid', 'truck_pin') then
    raise exception 'invalid_truck_credential_type';
  end if;

  return query
  update public.access_credentials c
     set is_active = p_is_active,
         updated_at = now()
   where c.id = p_credential_id
     and c.truck_id = p_truck_id
     and c.staff_member_id is null
     and c.credential_type = p_credential_type
     and public.is_warehouse_owner(c.warehouse_id)
  returning c.id, c.truck_id, c.credential_type,
    c.is_active, c.created_at, c.updated_at;

  if not found then
    raise exception 'truck_credential_not_owned';
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
   where c.truck_id is not null
     and c.staff_member_id is null
     and c.credential_type in ('truck_rfid', 'truck_pin')
   order by c.credential_type, c.created_at, c.id;
$$;

revoke all on function public.manage_truck_credential(uuid, text, text, uuid, boolean)
  from public, anon;
revoke all on function public.set_truck_credential_active(uuid, uuid, text, boolean)
  from public, anon;
revoke all on function public.list_truck_credentials() from public, anon;

grant execute on function public.manage_truck_credential(uuid, text, text, uuid, boolean)
  to authenticated;
grant execute on function public.set_truck_credential_active(uuid, uuid, text, boolean)
  to authenticated;
grant execute on function public.list_truck_credentials() to authenticated;
