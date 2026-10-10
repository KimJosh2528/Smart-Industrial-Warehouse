-- Separate RFID pools by credential tab/type.

alter table public.rfid_pool
  add column if not exists credential_scope text not null default 'staff';

alter table public.rfid_pool
  drop constraint if exists rfid_pool_credential_scope_check;

alter table public.rfid_pool
  add constraint rfid_pool_credential_scope_check
  check (credential_scope in ('staff', 'guard', 'truck'));

-- The previous version returned a different table shape. PostgreSQL cannot
-- change OUT/RETURNS TABLE columns with CREATE OR REPLACE, so drop only the
-- no-argument function before recreating it with credential_scope included.
drop function if exists public.list_rfid_pool_uids();

create or replace function public.list_rfid_pool_uids()
returns table(id uuid, warehouse_id uuid, uid_label text, credential_scope text, status text)
language sql stable security definer set search_path = public, extensions
as $$
  select r.id, r.warehouse_id, r.uid_label, r.credential_scope, r.status
    from public.rfid_pool r
   where exists (select 1 from public.warehouses w where w.id = r.warehouse_id and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid()))
   order by r.credential_scope, r.status, r.uid_label;
$$;

create or replace function public.list_vacant_rfid_uids_for_scope(p_scope text)
returns table(id uuid, uid_label text, credential_scope text)
language sql stable security definer set search_path = public, extensions
as $$
  select r.id, r.uid_label, r.credential_scope
    from public.rfid_pool r
   where r.status = 'vacant'
     and r.credential_scope = p_scope
     and exists (select 1 from public.warehouses w where w.id = r.warehouse_id and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid()))
   order by r.uid_label;
$$;

create or replace function public.create_rfid_pool_uid(p_warehouse_id uuid, p_uid_label text, p_scope text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare clean_uid text := lower(btrim(p_uid_label)); created_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_scope not in ('staff', 'guard', 'truck') then raise exception 'invalid_rfid_scope'; end if;
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse_id and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid())) then raise exception 'warehouse_not_owned'; end if;
  if clean_uid !~ '^[0-9a-f]+$' or length(clean_uid) not in (8, 14) then raise exception 'invalid_rfid'; end if;
  insert into public.rfid_pool (warehouse_id, uid_label, uid_hash, credential_scope)
  values (p_warehouse_id, clean_uid, encode(extensions.digest(convert_to(clean_uid, 'UTF8'), 'sha256'), 'hex'), p_scope)
  returning id into created_id;
  return created_id;
exception when unique_violation then raise exception 'rfid_already_in_pool';
end;
$$;

create or replace function public.assign_member_application_rfid(p_application_id uuid, p_rfid_pool_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare application_warehouse_id uuid; application_role text; rfid_warehouse_id uuid; rfid_scope text; expected_scope text;
begin
  select a.warehouse_id, a.requested_role into application_warehouse_id, application_role
    from public.warehouse_member_applications a
   where a.id = p_application_id and a.status = 'pending'
     and exists (select 1 from public.warehouses w where w.id = a.warehouse_id and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid()))
   for update;
  if application_warehouse_id is null then raise exception 'member_application_not_owned_or_pending'; end if;
  select r.warehouse_id, r.credential_scope into rfid_warehouse_id, rfid_scope
    from public.rfid_pool r where r.id = p_rfid_pool_id and r.status = 'vacant' for update;
  if rfid_warehouse_id is null or rfid_warehouse_id <> application_warehouse_id then raise exception 'rfid_not_vacant_or_wrong_warehouse'; end if;
  expected_scope := case when application_role = 'driver' then 'truck' else application_role end;
  if rfid_scope <> expected_scope then raise exception 'rfid_scope_mismatch'; end if;
  update public.rfid_pool set status = 'vacant', updated_at = now() where id = (select rfid_pool_id from public.member_application_rfid_assignments where application_id = p_application_id);
  insert into public.member_application_rfid_assignments (application_id, rfid_pool_id) values (p_application_id, p_rfid_pool_id)
  on conflict (application_id) do update set rfid_pool_id = excluded.rfid_pool_id;
  update public.rfid_pool set status = 'reserved', updated_at = now() where id = p_rfid_pool_id;
end;
$$;

revoke all on function public.list_rfid_pool_uids() from public, anon;
grant execute on function public.list_rfid_pool_uids() to authenticated;
revoke all on function public.list_vacant_rfid_uids_for_scope(text) from public, anon;
grant execute on function public.list_vacant_rfid_uids_for_scope(text) to authenticated;
revoke all on function public.create_rfid_pool_uid(uuid, text, text) from public, anon;
grant execute on function public.create_rfid_pool_uid(uuid, text, text) to authenticated;
revoke all on function public.assign_member_application_rfid(uuid, uuid) from public, anon;
grant execute on function public.assign_member_application_rfid(uuid, uuid) to authenticated;
