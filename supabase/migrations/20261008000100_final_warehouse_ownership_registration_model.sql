-- Final ownership model:
-- Father Admin owns the platform and administers all warehouses.
-- Each System Admin is assigned to exactly one warehouse and can only access it.
-- This migration preserves the existing owner_id column/data as a historical
-- ownership record, but removes it from authorization decisions.

create table if not exists public.system_admin_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_name text not null,
  applicant_email text not null,
  valid_id_url text not null,
  facebook_profile_url text not null,
  requested_warehouse_name text not null,
  status text not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  warehouse_id uuid references public.warehouses(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_admin_applications_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint system_admin_applications_name_check
    check (length(btrim(applicant_name)) >= 2),
  constraint system_admin_applications_warehouse_name_check
    check (length(btrim(requested_warehouse_name)) >= 2),
  constraint system_admin_applications_email_check
    check (position('@' in applicant_email) > 1),
  constraint system_admin_applications_valid_id_url_check
    check (valid_id_url ~* '^https://'),
  constraint system_admin_applications_facebook_url_check
    check (facebook_profile_url ~* '^https://(www\\.)?facebook\\.com/')
);

create unique index if not exists system_admin_applications_pending_email_key
  on public.system_admin_applications (lower(applicant_email))
  where status = 'pending';
create index if not exists system_admin_applications_status_created_idx
  on public.system_admin_applications (status, created_at desc);

alter table public.system_admin_applications enable row level security;
revoke all on public.system_admin_applications from public, anon, authenticated;

alter table public.account_claim_requests
  add column if not exists system_admin_application_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'account_claim_requests_system_admin_application_fkey'
      and conrelid = 'public.account_claim_requests'::regclass
  ) then
    alter table public.account_claim_requests
      add constraint account_claim_requests_system_admin_application_fkey
      foreign key (system_admin_application_id)
      references public.system_admin_applications(id)
      on delete cascade;
  end if;
end $$;

alter table public.account_claim_requests
  drop constraint if exists account_claim_requests_one_target;
alter table public.account_claim_requests
  add constraint account_claim_requests_one_target check (
    (staff_member_id is not null and driver_id is null and system_admin_application_id is null)
    or (staff_member_id is null and driver_id is not null and system_admin_application_id is null)
    or (staff_member_id is null and driver_id is null and system_admin_application_id is not null)
  );

create unique index if not exists account_claim_requests_system_admin_application_key
  on public.account_claim_requests(system_admin_application_id)
  where system_admin_application_id is not null;

-- A System Admin has one and only one warehouse context. The unique constraint
-- already enforces the upper bound; this helper enforces the exact assignment
-- required for an active system_admin profile.
create or replace function public.my_system_admin_warehouse_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  assigned_warehouse_id uuid;
  assigned_count integer;
begin
  if auth.uid() is null then
    return null;
  end if;

  select count(*)::integer, min(w.id)
    into assigned_count, assigned_warehouse_id
    from public.warehouses w
    where w.system_admin_id = auth.uid();

  if assigned_count > 1 then
    raise exception 'system_admin_multiple_warehouses';
  end if;

  return assigned_warehouse_id;
end;
$$;

revoke all on function public.my_system_admin_warehouse_id() from public, anon;
grant execute on function public.my_system_admin_warehouse_id() to authenticated;

create or replace function public.is_warehouse_owner(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_father_admin()
      or (
        public.my_system_admin_warehouse_id() is not null
        and target_warehouse_id = public.my_system_admin_warehouse_id()
      );
$$;

revoke all on function public.is_warehouse_owner(uuid) from public, anon;
grant execute on function public.is_warehouse_owner(uuid) to authenticated;

-- Only Father Admin can create or change platform ownership. A System Admin
-- may update ordinary metadata on their own warehouse, but never ownership.
create or replace function public.validate_final_warehouse_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null then
    raise exception 'warehouse_owner_required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = new.owner_id and p.role = 'father_admin'
  ) then
    raise exception 'warehouse_owner_must_be_father_admin';
  end if;

  if new.system_admin_id is not null
     and not exists (
       select 1 from public.profiles p
       where p.id = new.system_admin_id and p.role = 'system_admin'
     )
     and not (
       current_setting('app.system_admin_claim_id', true) = new.system_admin_id::text
       and new.system_admin_id = auth.uid()
     ) then
    raise exception 'warehouse_system_admin_must_have_system_admin_role';
  end if;

  if auth.uid() is not null and not public.is_father_admin()
     and current_setting('app.system_admin_claim_id', true) is distinct from new.system_admin_id::text then
    if tg_op = 'INSERT' then
      raise exception 'only_father_admin_may_change_warehouse_ownership';
    elsif new.owner_id is distinct from old.owner_id
       or new.system_admin_id is distinct from old.system_admin_id then
      raise exception 'only_father_admin_may_change_warehouse_ownership';
    end if;
  end if;

  if new.system_admin_id is not null and exists (
    select 1 from public.warehouses w
    where w.system_admin_id = new.system_admin_id
      and w.id <> new.id
  ) then
    raise exception 'system_admin_already_assigned';
  end if;

  return new;
end;
$$;

drop trigger if exists warehouses_system_admin_assignment_guard on public.warehouses;
drop trigger if exists warehouses_final_ownership_guard on public.warehouses;
create trigger warehouses_final_ownership_guard
  before insert or update of owner_id, system_admin_id on public.warehouses
  for each row execute function public.validate_final_warehouse_ownership();

revoke all on function public.validate_final_warehouse_ownership() from public, anon, authenticated;
drop function if exists public.validate_system_admin_assignment();

create or replace function public.validate_system_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_father_admin()
     and current_setting('app.system_admin_claim_id', true) is distinct from new.id::text then
    raise exception 'only_father_admin_may_change_platform_role';
  end if;

  if new.role = 'system_admin' and not exists (
    select 1 from public.warehouses w where w.system_admin_id = new.id
  ) and current_setting('app.system_admin_claim_id', true) is distinct from new.id::text then
    raise exception 'system_admin_requires_exactly_one_warehouse';
  end if;

  if new.role is distinct from 'system_admin' and exists (
    select 1 from public.warehouses w where w.system_admin_id = new.id
  ) then
    raise exception 'assigned_system_admin_must_keep_system_admin_role';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_system_admin_role_guard on public.profiles;
create trigger profiles_system_admin_role_guard
  before update of role on public.profiles
  for each row execute function public.validate_system_admin_role_change();

revoke all on function public.validate_system_admin_role_change() from public, anon, authenticated;

-- Remove the legacy owner_id policy bridge. Father Admin is global; System
-- Admin access is always derived from warehouses.system_admin_id = auth.uid().
drop policy if exists warehouses_select_owned on public.warehouses;
drop policy if exists warehouses_insert_owned on public.warehouses;
drop policy if exists warehouses_update_owned on public.warehouses;
drop policy if exists warehouses_delete_owned on public.warehouses;
drop policy if exists warehouses_select_system_admin_or_father on public.warehouses;
drop policy if exists warehouses_insert_father on public.warehouses;
drop policy if exists warehouses_update_system_admin_or_father on public.warehouses;
drop policy if exists warehouses_delete_father on public.warehouses;

create policy warehouses_select_final
  on public.warehouses for select to authenticated
  using (public.is_father_admin() or system_admin_id = auth.uid());

create policy warehouses_insert_final
  on public.warehouses for insert to authenticated
  with check (public.is_father_admin() and owner_id = auth.uid());

create policy warehouses_update_final
  on public.warehouses for update to authenticated
  using (public.is_father_admin() or system_admin_id = auth.uid())
  with check (public.is_father_admin() or system_admin_id = auth.uid());

create policy warehouses_delete_final
  on public.warehouses for delete to authenticated
  using (public.is_father_admin());

-- Father Admin-only assignment. Existing assignments cannot be moved or
-- cleared through this compatibility RPC; new assignments remain one-to-one.
create or replace function public.assign_system_admin(
  target_warehouse_id uuid,
  target_system_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_assignee uuid;
begin
  if not public.is_father_admin() then
    raise exception 'only_father_admin_may_assign_system_admin';
  end if;

  select w.system_admin_id into current_assignee
    from public.warehouses w
   where w.id = target_warehouse_id
   for update;
  if not found then raise exception 'warehouse_not_found'; end if;
  if target_system_admin_id is null then
    if current_assignee is not null then raise exception 'system_admin_assignment_immutable'; end if;
    return;
  end if;
  if current_assignee is not null and current_assignee <> target_system_admin_id then
    raise exception 'system_admin_assignment_immutable';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_system_admin_id and p.role = 'system_admin') then
    raise exception 'target_profile_must_have_system_admin_role';
  end if;
  if exists (select 1 from public.warehouses w where w.system_admin_id = target_system_admin_id and w.id <> target_warehouse_id) then
    raise exception 'system_admin_already_assigned';
  end if;
  update public.warehouses set system_admin_id = target_system_admin_id where id = target_warehouse_id;
end;
$$;

revoke all on function public.assign_system_admin(uuid, uuid) from public, anon;
grant execute on function public.assign_system_admin(uuid, uuid) to authenticated;

-- Public application submission; raw identity documents are represented by a
-- secure URL/reference and are never exposed through the table API.
create or replace function public.submit_system_admin_application(
  p_applicant_name text,
  p_applicant_email text,
  p_valid_id_url text,
  p_facebook_profile_url text,
  p_requested_warehouse_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare application_id uuid;
begin
  if length(btrim(coalesce(p_applicant_name, ''))) < 2
     or position('@' in btrim(coalesce(p_applicant_email, ''))) <= 1
     or p_valid_id_url !~* '^https://'
     or p_facebook_profile_url !~* '^https://(www\\.)?facebook\\.com/'
     or length(btrim(coalesce(p_requested_warehouse_name, ''))) < 2 then
    raise exception 'system_admin_application_invalid';
  end if;

  insert into public.system_admin_applications (
    applicant_name, applicant_email, valid_id_url, facebook_profile_url, requested_warehouse_name
  ) values (
    btrim(p_applicant_name), lower(btrim(p_applicant_email)), btrim(p_valid_id_url),
    btrim(p_facebook_profile_url), btrim(p_requested_warehouse_name)
  ) returning id into application_id;
  return application_id;
exception when unique_violation then
  raise exception 'system_admin_application_already_pending';
end;
$$;

revoke all on function public.submit_system_admin_application(text, text, text, text, text) from public;
grant execute on function public.submit_system_admin_application(text, text, text, text, text) to anon, authenticated;

create or replace function public.list_system_admin_applications()
returns table(
  id uuid, applicant_name text, applicant_email text, valid_id_url text,
  facebook_profile_url text, requested_warehouse_name text, status text,
  rejection_reason text, warehouse_id uuid, created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select a.id, a.applicant_name, a.applicant_email, a.valid_id_url,
         a.facebook_profile_url, a.requested_warehouse_name, a.status,
         a.rejection_reason, a.warehouse_id, a.created_at
    from public.system_admin_applications a
   where public.is_father_admin()
   order by a.created_at desc;
$$;

revoke all on function public.list_system_admin_applications() from public, anon;
grant execute on function public.list_system_admin_applications() to authenticated;

create or replace function public.approve_system_admin_application(
  p_application_id uuid,
  p_warehouse_name text default null
)
returns table(warehouse_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  application_row public.system_admin_applications;
  created_warehouse_id uuid;
  generated_token text;
  generated_expires_at timestamptz;
begin
  if not public.is_father_admin() then raise exception 'only_father_admin_may_approve'; end if;
  select * into application_row from public.system_admin_applications where id = p_application_id for update;
  if application_row.id is null then raise exception 'system_admin_application_not_found'; end if;
  if application_row.status <> 'pending' then raise exception 'system_admin_application_not_pending'; end if;

  insert into public.warehouses (owner_id, name, system_admin_id)
  values (auth.uid(), coalesce(nullif(btrim(p_warehouse_name), ''), application_row.requested_warehouse_name), null)
  returning id into created_warehouse_id;

  generated_token := encode(gen_random_bytes(32), 'hex');
  generated_expires_at := now() + interval '24 hours';
  insert into public.account_claim_requests (
    warehouse_id, system_admin_application_id, token_hash, expires_at, created_by
  ) values (
    created_warehouse_id, application_row.id, encode(digest(generated_token, 'sha256'), 'hex'),
    generated_expires_at, auth.uid()
  );

  update public.system_admin_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         warehouse_id = created_warehouse_id, updated_at = now()
   where id = application_row.id;

  return query select created_warehouse_id, generated_token, generated_expires_at;
end;
$$;

create or replace function public.reject_system_admin_application(
  p_application_id uuid,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_father_admin() then raise exception 'only_father_admin_may_reject'; end if;
  update public.system_admin_applications
     set status = 'rejected', rejection_reason = nullif(btrim(p_rejection_reason), ''),
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_application_id and status = 'pending';
  if not found then raise exception 'system_admin_application_not_pending'; end if;
end;
$$;

revoke all on function public.approve_system_admin_application(uuid, text) from public, anon;
revoke all on function public.reject_system_admin_application(uuid, text) from public, anon;
grant execute on function public.approve_system_admin_application(uuid, text) to authenticated;
grant execute on function public.reject_system_admin_application(uuid, text) to authenticated;

-- Extend the existing one-time account-claim flow for approved System Admins.
create or replace function public.get_account_claim(p_token_hash text)
returns table(
  claim_kind text, target_id uuid, display_name text, warehouse_name text,
  truck_plate_number text, truck_division text, expires_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare request_row public.account_claim_requests;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return; end if;
  select r.* into request_row from public.account_claim_requests r
   where r.token_hash = p_token_hash and r.used_at is null and r.revoked_at is null and r.expires_at > now();
  if request_row.id is null then return; end if;
  if request_row.system_admin_application_id is not null then
    return query select 'system_admin'::text, a.id, a.applicant_name, w.name,
      null::text, null::text, request_row.expires_at
      from public.system_admin_applications a join public.warehouses w on w.id = request_row.warehouse_id
      where a.id = request_row.system_admin_application_id and a.status = 'approved';
  elsif request_row.staff_member_id is not null then
    return query select 'staff'::text, s.id, s.display_name, w.name, null::text, null::text, request_row.expires_at
      from public.staff_members s join public.warehouses w on w.id = s.warehouse_id
      where s.id = request_row.staff_member_id and s.profile_id is null;
  else
    return query select 'driver'::text, d.id, d.display_name, w.name, t.plate_number, t.division, request_row.expires_at
      from public.drivers d join public.warehouses w on w.id = d.warehouse_id
      left join public.trucks t on t.current_driver_id = d.id
      where d.id = request_row.driver_id and d.profile_id is null;
  end if;
end;
$$;

create or replace function public.claim_account(p_token_hash text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.account_claim_requests;
  existing_profile_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_claim_token'; end if;
  select r.* into request_row from public.account_claim_requests r where r.token_hash = p_token_hash for update;
  if request_row.id is null or request_row.expires_at <= now() or request_row.used_at is not null or request_row.revoked_at is not null then raise exception 'claim_request_invalid'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid()) then raise exception 'profile_not_found'; end if;

  if request_row.system_admin_application_id is not null then
    if not exists (select 1 from public.system_admin_applications a where a.id = request_row.system_admin_application_id and a.status = 'approved' and a.warehouse_id = request_row.warehouse_id) then raise exception 'system_admin_application_invalid'; end if;
    if exists (select 1 from public.profiles p where p.id = auth.uid() and p.role is not null) then raise exception 'profile_already_assigned'; end if;
    if exists (select 1 from public.warehouses w where w.system_admin_id = auth.uid()) then raise exception 'system_admin_already_assigned'; end if;
    perform set_config('app.system_admin_claim_id', auth.uid()::text, true);
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
  return case when request_row.system_admin_application_id is not null then 'system_admin' when request_row.staff_member_id is not null then 'staff' else 'driver' end;
end;
$$;

revoke all on function public.get_account_claim(text) from public;
revoke all on function public.claim_account(text) from public, anon;
grant execute on function public.get_account_claim(text) to anon, authenticated;
grant execute on function public.claim_account(text) to authenticated;

comment on column public.warehouses.owner_id is
  'Historical platform owner reference. Authorization uses Father Admin role and system_admin_id, never owner_id.';
comment on column public.warehouses.system_admin_id is
  'Immutable one-to-one operational assignment. A System Admin can be assigned to exactly one warehouse.';
