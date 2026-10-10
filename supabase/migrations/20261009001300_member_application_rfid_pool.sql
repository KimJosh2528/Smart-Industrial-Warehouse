-- Reserved RFID pool for application-time assignment.
-- UIDs are kept warehouse-scoped and are not exposed to unauthorised users.

create table if not exists public.rfid_pool (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  uid_label text not null,
  uid_hash text not null,
  status text not null default 'vacant' check (status in ('vacant', 'reserved', 'assigned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, uid_label),
  unique (warehouse_id, uid_hash)
);

create table if not exists public.member_application_rfid_assignments (
  application_id uuid primary key references public.warehouse_member_applications(id) on delete cascade,
  rfid_pool_id uuid not null unique references public.rfid_pool(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.rfid_pool enable row level security;
alter table public.member_application_rfid_assignments enable row level security;
revoke all on public.rfid_pool from public, anon, authenticated;
revoke all on public.member_application_rfid_assignments from public, anon, authenticated;

create or replace function public.list_vacant_rfid_uids()
returns table(id uuid, uid_label text)
language sql stable security definer set search_path = public, extensions
as $$
  select r.id, r.uid_label
    from public.rfid_pool r
   where r.status = 'vacant'
     and exists (
       select 1 from public.warehouses w
        where w.id = r.warehouse_id
          and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid())
     )
   order by r.uid_label;
$$;

-- The legacy function has a different RETURNS TABLE shape on the demo
-- project; PostgreSQL requires an explicit drop before replacing OUT columns.
drop function if exists public.list_rfid_pool_uids();

create or replace function public.list_rfid_pool_uids()
returns table(id uuid, warehouse_id uuid, uid_label text, status text)
language sql stable security definer set search_path = public, extensions
as $$
  select r.id, r.warehouse_id, r.uid_label, r.status
    from public.rfid_pool r
   where exists (select 1 from public.warehouses w where w.id = r.warehouse_id and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid()))
   order by r.status, r.uid_label;
$$;

create or replace function public.create_rfid_pool_uid(p_warehouse_id uuid, p_uid_label text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare clean_uid text := lower(btrim(p_uid_label)); created_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse_id and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid())) then raise exception 'warehouse_not_owned'; end if;
  if clean_uid !~ '^[0-9a-f]+$' or length(clean_uid) % 2 <> 0 then raise exception 'invalid_rfid'; end if;
  insert into public.rfid_pool (warehouse_id, uid_label, uid_hash)
  values (p_warehouse_id, clean_uid, encode(extensions.digest(convert_to(clean_uid, 'UTF8'), 'sha256'), 'hex'))
  returning id into created_id;
  return created_id;
exception when unique_violation then raise exception 'rfid_already_in_pool';
end;
$$;

create or replace function public.assign_member_application_rfid(
  p_application_id uuid,
  p_rfid_pool_id uuid
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  application_warehouse_id uuid;
  rfid_warehouse_id uuid;
begin
  select a.warehouse_id into application_warehouse_id
    from public.warehouse_member_applications a
   where a.id = p_application_id
     and a.status = 'pending'
     and exists (
       select 1 from public.warehouses w
        where w.id = a.warehouse_id
          and (w.father_admin_id = auth.uid() or w.system_admin_id = auth.uid())
     )
   for update;
  if application_warehouse_id is null then raise exception 'member_application_not_owned_or_pending'; end if;

  select r.warehouse_id into rfid_warehouse_id
    from public.rfid_pool r
   where r.id = p_rfid_pool_id and r.status = 'vacant'
   for update;
  if rfid_warehouse_id is null or rfid_warehouse_id <> application_warehouse_id then
    raise exception 'rfid_not_vacant_or_wrong_warehouse';
  end if;

  update public.rfid_pool r
     set status = 'vacant', updated_at = now()
   where r.id = (
     select x.rfid_pool_id
       from public.member_application_rfid_assignments x
      where x.application_id = p_application_id
   );

  insert into public.member_application_rfid_assignments (application_id, rfid_pool_id)
  values (p_application_id, p_rfid_pool_id)
  on conflict (application_id) do update set rfid_pool_id = excluded.rfid_pool_id;

  update public.rfid_pool set status = 'reserved', updated_at = now() where id = p_rfid_pool_id;
end;
$$;

revoke all on function public.list_vacant_rfid_uids() from public, anon;
grant execute on function public.list_vacant_rfid_uids() to authenticated;
revoke all on function public.list_rfid_pool_uids() from public, anon;
grant execute on function public.list_rfid_pool_uids() to authenticated;
revoke all on function public.create_rfid_pool_uid(uuid, text) from public, anon;
grant execute on function public.create_rfid_pool_uid(uuid, text) to authenticated;
revoke all on function public.assign_member_application_rfid(uuid, uuid) from public, anon;
grant execute on function public.assign_member_application_rfid(uuid, uuid) to authenticated;
