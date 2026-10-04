-- Secure one-time Staff/Driver account claim requests.
-- Raw tokens are returned only once by the creation RPC and are never stored.

create table public.account_claim_requests (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  constraint account_claim_requests_one_target check (
    (staff_member_id is not null and driver_id is null)
    or (staff_member_id is null and driver_id is not null)
  ),
  constraint account_claim_requests_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint account_claim_requests_expiry check (expires_at > created_at)
);

create index account_claim_requests_staff_idx
  on public.account_claim_requests(staff_member_id)
  where staff_member_id is not null and used_at is null and revoked_at is null;

create index account_claim_requests_driver_idx
  on public.account_claim_requests(driver_id)
  where driver_id is not null and used_at is null and revoked_at is null;

alter table public.account_claim_requests enable row level security;
revoke all on public.account_claim_requests from public, anon, authenticated;

create or replace function public.create_account_claim_request(
  p_staff_member_id uuid default null,
  p_driver_id uuid default null
)
returns table(request_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_warehouse_id uuid;
  target_profile_id uuid;
  generated_token text;
  generated_expires_at timestamptz;
  created_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if (p_staff_member_id is null) = (p_driver_id is null) then
    raise exception 'claim_target_required';
  end if;

  if p_staff_member_id is not null then
    select s.warehouse_id, s.profile_id
      into target_warehouse_id, target_profile_id
      from public.staff_members s
     where s.id = p_staff_member_id
     for update;
    if target_warehouse_id is null then
      raise exception 'staff_member_not_found';
    end if;
    if target_profile_id is not null then
      raise exception 'staff_already_claimed';
    end if;
  else
    select d.warehouse_id, d.profile_id
      into target_warehouse_id, target_profile_id
      from public.drivers d
     where d.id = p_driver_id
     for update;
    if target_warehouse_id is null then
      raise exception 'driver_not_found';
    end if;
    if target_profile_id is not null then
      raise exception 'driver_already_claimed';
    end if;
  end if;

  if not public.is_warehouse_owner(target_warehouse_id) then
    raise exception 'warehouse_not_owned';
  end if;

  if p_staff_member_id is not null then
    update public.account_claim_requests
       set revoked_at = now()
     where staff_member_id = p_staff_member_id
       and used_at is null
       and revoked_at is null;
  else
    update public.account_claim_requests
       set revoked_at = now()
     where driver_id = p_driver_id
       and used_at is null
       and revoked_at is null;
  end if;

  generated_token := encode(gen_random_bytes(32), 'hex');
  generated_expires_at := now() + interval '24 hours';

  insert into public.account_claim_requests (
    warehouse_id,
    staff_member_id,
    driver_id,
    token_hash,
    expires_at,
    created_by
  )
  values (
    target_warehouse_id,
    p_staff_member_id,
    p_driver_id,
    encode(digest(generated_token, 'sha256'), 'hex'),
    generated_expires_at,
    auth.uid()
  )
  returning id into created_request_id;

  return query select created_request_id, generated_token, generated_expires_at;
end;
$$;

create or replace function public.list_staff_account_claim(p_staff_member_id uuid)
returns table(request_id uuid, status text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         'INVITED'::text,
         r.expires_at
    from public.account_claim_requests r
    join public.staff_members s on s.id = r.staff_member_id
   where r.staff_member_id = p_staff_member_id
     and s.profile_id is null
     and public.is_warehouse_owner(s.warehouse_id)
     and r.used_at is null
     and r.revoked_at is null
     and r.expires_at > now()
   order by r.created_at desc
   limit 1;
$$;

create or replace function public.list_driver_account_claim(p_driver_id uuid)
returns table(request_id uuid, status text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         'INVITED'::text,
         r.expires_at
    from public.account_claim_requests r
    join public.drivers d on d.id = r.driver_id
   where r.driver_id = p_driver_id
     and d.profile_id is null
     and public.is_warehouse_owner(d.warehouse_id)
     and r.used_at is null
     and r.revoked_at is null
     and r.expires_at > now()
   order by r.created_at desc
   limit 1;
$$;

create or replace function public.revoke_account_claim_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update public.account_claim_requests r
     set revoked_at = now()
   where r.id = p_request_id
     and r.used_at is null
     and r.revoked_at is null
     and public.is_warehouse_owner(r.warehouse_id);

  if not found then
    raise exception 'claim_request_not_owned';
  end if;
end;
$$;

create or replace function public.get_account_claim(p_token_hash text)
returns table(
  claim_kind text,
  target_id uuid,
  display_name text,
  warehouse_name text,
  truck_plate_number text,
  truck_division text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.account_claim_requests;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select r.*
    into request_row
    from public.account_claim_requests r
   where r.token_hash = p_token_hash
     and r.used_at is null
     and r.revoked_at is null
     and r.expires_at > now();

  if request_row.id is null then
    return;
  end if;

  if request_row.staff_member_id is not null then
    return query
      select 'staff'::text,
             s.id,
             s.display_name,
             w.name,
             null::text,
             null::text,
             request_row.expires_at
        from public.staff_members s
        join public.warehouses w on w.id = s.warehouse_id
       where s.id = request_row.staff_member_id
         and s.profile_id is null;
  else
    return query
      select 'driver'::text,
             d.id,
             d.display_name,
             w.name,
             t.plate_number,
             t.division,
             request_row.expires_at
        from public.drivers d
        join public.warehouses w on w.id = d.warehouse_id
        left join public.trucks t on t.current_driver_id = d.id
       where d.id = request_row.driver_id
         and d.profile_id is null;
  end if;
end;
$$;

create or replace function public.claim_account(p_token_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.account_claim_requests;
  existing_profile_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_claim_token';
  end if;

  select r.*
    into request_row
    from public.account_claim_requests r
   where r.token_hash = p_token_hash
   for update;

  if request_row.id is null
     or request_row.expires_at <= now()
     or request_row.used_at is not null
     or request_row.revoked_at is not null then
    raise exception 'claim_request_invalid';
  end if;

  if not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    raise exception 'profile_not_found';
  end if;

  if request_row.staff_member_id is not null then
    select s.profile_id into existing_profile_id
      from public.staff_members s
     where s.id = request_row.staff_member_id
     for update;
    if existing_profile_id is null then
      if exists (select 1 from public.staff_members s where s.profile_id = auth.uid()) then
        raise exception 'profile_already_claimed_staff';
      end if;
      update public.staff_members
         set profile_id = auth.uid()
       where id = request_row.staff_member_id
         and profile_id is null;
      if not found then
        raise exception 'staff_already_claimed';
      end if;
    else
      raise exception 'staff_already_claimed';
    end if;
  else
    select d.profile_id into existing_profile_id
      from public.drivers d
     where d.id = request_row.driver_id
     for update;
    if existing_profile_id is null then
      if exists (select 1 from public.drivers d where d.profile_id = auth.uid()) then
        raise exception 'profile_already_claimed_driver';
      end if;
      update public.drivers
         set profile_id = auth.uid()
       where id = request_row.driver_id
         and profile_id is null;
      if not found then
        raise exception 'driver_already_claimed';
      end if;
    else
      raise exception 'driver_already_claimed';
    end if;
  end if;

  update public.account_claim_requests
     set used_at = now(), revoked_at = now()
   where id = request_row.id;

  return case when request_row.staff_member_id is not null then 'staff' else 'driver' end;
end;
$$;

revoke all on function public.create_account_claim_request(uuid, uuid) from public, anon;
revoke all on function public.list_staff_account_claim(uuid) from public, anon;
revoke all on function public.list_driver_account_claim(uuid) from public, anon;
revoke all on function public.revoke_account_claim_request(uuid) from public, anon;
revoke all on function public.get_account_claim(text) from public;
revoke all on function public.claim_account(text) from public, anon;

grant execute on function public.create_account_claim_request(uuid, uuid) to authenticated;
grant execute on function public.list_staff_account_claim(uuid) to authenticated;
grant execute on function public.list_driver_account_claim(uuid) to authenticated;
grant execute on function public.revoke_account_claim_request(uuid) to authenticated;
grant execute on function public.get_account_claim(text) to anon, authenticated;
grant execute on function public.claim_account(text) to authenticated;
