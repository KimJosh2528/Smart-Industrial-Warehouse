-- The linked database had the claim-request table and creation RPC, but was
-- missing the lookup/claim RPCs used by staff, guard, and driver registration.

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

  select r.* into request_row
    from public.account_claim_requests r
   where r.token_hash = p_token_hash
     and r.used_at is null
     and r.revoked_at is null
     and r.expires_at > now();

  if request_row.id is null then
    return;
  end if;

  if request_row.system_admin_application_id is not null then
    return query
      select 'system_admin'::text, a.id, a.applicant_name, w.name,
             null::text, null::text, request_row.expires_at
        from public.system_admin_applications a
        join public.warehouses w on w.id = request_row.warehouse_id
       where a.id = request_row.system_admin_application_id
         and a.status = 'approved';
  elsif request_row.staff_member_id is not null then
    return query
      select 'staff'::text, s.id, s.display_name, w.name,
             null::text, null::text, request_row.expires_at
        from public.staff_members s
        join public.warehouses w on w.id = s.warehouse_id
       where s.id = request_row.staff_member_id
         and s.profile_id is null;
  else
    return query
      select 'driver'::text, d.id, d.display_name, w.name,
             t.plate_number, t.division, request_row.expires_at
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
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_claim_token'; end if;

  select r.* into request_row
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

  if request_row.system_admin_application_id is not null then
    if not exists (
      select 1 from public.system_admin_applications a
       where a.id = request_row.system_admin_application_id
         and a.status = 'approved'
         and a.warehouse_id = request_row.warehouse_id
    ) then raise exception 'system_admin_application_invalid'; end if;
    if exists (select 1 from public.profiles p where p.id = auth.uid() and p.role is not null) then raise exception 'profile_already_assigned'; end if;
    if exists (select 1 from public.warehouses w where w.system_admin_id = auth.uid()) then raise exception 'system_admin_already_assigned'; end if;
    update public.warehouses set system_admin_id = auth.uid() where id = request_row.warehouse_id and system_admin_id is null;
    if not found then raise exception 'warehouse_already_assigned'; end if;
    update public.profiles set role = 'system_admin' where id = auth.uid() and role is null;
    if not found then raise exception 'profile_already_assigned'; end if;
  elsif request_row.staff_member_id is not null then
    select s.profile_id into existing_profile_id from public.staff_members s where s.id = request_row.staff_member_id for update;
    if existing_profile_id is null then
      if exists (select 1 from public.staff_members s where s.profile_id = auth.uid()) then raise exception 'profile_already_claimed_staff'; end if;
      update public.staff_members set profile_id = auth.uid() where id = request_row.staff_member_id and profile_id is null;
      if not found then raise exception 'staff_already_claimed'; end if;
    else raise exception 'staff_already_claimed'; end if;
  else
    select d.profile_id into existing_profile_id from public.drivers d where d.id = request_row.driver_id for update;
    if existing_profile_id is null then
      if exists (select 1 from public.drivers d where d.profile_id = auth.uid()) then raise exception 'profile_already_claimed_driver'; end if;
      update public.drivers set profile_id = auth.uid() where id = request_row.driver_id and profile_id is null;
      if not found then raise exception 'driver_already_claimed'; end if;
    else raise exception 'driver_already_claimed'; end if;
  end if;

  update public.account_claim_requests set used_at = now(), revoked_at = now() where id = request_row.id;
  return case
    when request_row.system_admin_application_id is not null then 'system_admin'
    when request_row.staff_member_id is not null then 'staff'
    else 'driver'
  end;
end;
$$;

revoke all on function public.get_account_claim(text) from public;
revoke all on function public.claim_account(text) from public, anon;
grant execute on function public.get_account_claim(text) to anon, authenticated;
grant execute on function public.claim_account(text) to authenticated;
