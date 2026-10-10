-- Restore the auth-to-profile bridge on environments where the original
-- trigger was skipped, and let an already-created auth user finish a claim.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'User'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.claim_account(p_token_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.account_claim_requests;
  existing_profile_id uuid;
  profile_name text;
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

  select coalesce(
    (select s.display_name from public.staff_members s where s.id = request_row.staff_member_id),
    (select d.display_name from public.drivers d where d.id = request_row.driver_id),
    'User'
  ) into profile_name;

  insert into public.profiles (id, display_name)
  values (auth.uid(), profile_name)
  on conflict (id) do nothing;

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

revoke all on function public.claim_account(text) from public, anon;
grant execute on function public.claim_account(text) to authenticated;
