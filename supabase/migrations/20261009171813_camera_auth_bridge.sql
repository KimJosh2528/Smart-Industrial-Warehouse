-- Camera-server bridge for approved face labels and registered truck plates.
-- The ESP Main local HTTP access flow is intentionally unchanged.

-- Older demo schemas have only the primary key on staff_members.id. The
-- warehouse-scoped foreign key below needs the composite key explicitly.
create unique index if not exists staff_members_id_warehouse_id_key
  on public.staff_members(id, warehouse_id);

-- Repair the demo's missing compatibility function using its current
-- Father Admin/System Admin warehouse authorization model.
create or replace function public.is_warehouse_owner(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_father_admin()
      or public.is_system_admin_for_warehouse(target_warehouse_id);
$$;

revoke all on function public.is_warehouse_owner(uuid) from public, anon;
grant execute on function public.is_warehouse_owner(uuid) to authenticated;

create table public.camera_face_mappings (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  face_label text not null,
  is_active boolean not null default true,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, face_label),
  unique (staff_member_id),
  constraint camera_face_mappings_label_not_blank check (length(btrim(face_label)) > 0),
  foreign key (staff_member_id, warehouse_id)
    references public.staff_members(id, warehouse_id) on delete cascade
);

create index camera_face_mappings_lookup_idx
  on public.camera_face_mappings(warehouse_id, lower(face_label))
  where is_active;

create unique index camera_face_mappings_casefold_label_key
  on public.camera_face_mappings(warehouse_id, lower(face_label));

alter table public.camera_face_mappings enable row level security;

create policy camera_face_mappings_select_owned
  on public.camera_face_mappings for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy camera_face_mappings_insert_owned
  on public.camera_face_mappings for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy camera_face_mappings_update_owned
  on public.camera_face_mappings for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy camera_face_mappings_delete_owned
  on public.camera_face_mappings for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create or replace function public.manage_camera_face_mapping(
  p_warehouse_id uuid,
  p_staff_member_id uuid,
  p_face_label text,
  p_mapping_id uuid default null,
  p_is_active boolean default true
)
returns public.camera_face_mappings
language plpgsql
security definer
set search_path = public
as $$
declare
  mapping public.camera_face_mappings;
  member_type text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_warehouse_owner(p_warehouse_id) then raise exception 'warehouse_not_owned'; end if;
  if p_face_label is null or btrim(p_face_label) = '' then raise exception 'face_label_required'; end if;

  select s.member_type into member_type
    from public.staff_members s
   where s.id = p_staff_member_id
     and s.warehouse_id = p_warehouse_id
     and s.is_active;
  if member_type is null or member_type not in ('staff', 'guard') then
    raise exception 'face_mapping_subject_invalid';
  end if;

  if p_mapping_id is null then
    insert into public.camera_face_mappings
      (warehouse_id, staff_member_id, face_label, is_active, approved_by)
    values
      (p_warehouse_id, p_staff_member_id, btrim(p_face_label), coalesce(p_is_active, true), auth.uid())
    returning * into mapping;
  else
    update public.camera_face_mappings m
       set face_label = btrim(p_face_label),
           is_active = coalesce(p_is_active, m.is_active),
           approved_by = auth.uid(), approved_at = now(), updated_at = now()
     where m.id = p_mapping_id and m.warehouse_id = p_warehouse_id
    returning * into mapping;
    if mapping.id is null then raise exception 'face_mapping_not_owned'; end if;
  end if;
  return mapping;
end;
$$;

revoke all on function public.manage_camera_face_mapping(uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.manage_camera_face_mapping(uuid, uuid, text, uuid, boolean) to authenticated;

-- Driver applications are finalized together with their truck identity. The
-- driver RFID becomes the truck RFID credential; plate and division live on
-- the same truck record, so no separate access-review row is needed.
create or replace function public.finalize_driver_application(
  p_application_id uuid,
  p_rfid_pool_id uuid,
  p_identity_label text,
  p_plate_number text,
  p_division text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  application_row public.warehouse_member_applications;
  rfid_row public.rfid_pool;
  driver_id uuid;
  truck_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into application_row
    from public.warehouse_member_applications
   where id = p_application_id and status = 'pending' and requested_role = 'driver'
     and (public.is_father_admin() or public.is_system_admin_for_warehouse(warehouse_id))
   for update;
  if application_row.id is null then raise exception 'driver_application_not_owned_or_pending'; end if;
  if p_identity_label is null or btrim(p_identity_label) = '' then raise exception 'truck_identity_required'; end if;
  if p_plate_number is null or btrim(p_plate_number) = '' then raise exception 'truck_plate_required'; end if;
  if p_division not in ('RECEIVING_INCOMING', 'PICKING_STAGING_OUTGOING') then raise exception 'invalid_truck_division'; end if;

  select * into rfid_row from public.rfid_pool
   where id = p_rfid_pool_id and warehouse_id = application_row.warehouse_id
     and status in ('vacant', 'reserved') and credential_scope = 'truck'
   for update;
  if rfid_row.id is null then raise exception 'rfid_not_vacant_or_wrong_scope'; end if;

  insert into public.drivers (warehouse_id, display_name, is_active)
  values (application_row.warehouse_id, application_row.applicant_name, true)
  returning id into driver_id;

  insert into public.trucks (warehouse_id, identity_label, plate_number, normalized_plate, is_active, current_driver_id, division)
  values (application_row.warehouse_id, btrim(p_identity_label), btrim(p_plate_number), btrim(p_plate_number), true, driver_id, p_division)
  returning id into truck_id;

  insert into public.access_credentials (warehouse_id, staff_member_id, truck_id, credential_type, credential_hash, is_active)
  values (application_row.warehouse_id, null, truck_id, 'truck_rfid', rfid_row.uid_hash, true);

  insert into public.access_permissions (warehouse_id, area_id, staff_member_id, truck_id)
  select application_row.warehouse_id, a.id, null, truck_id
    from public.warehouse_areas a
   where a.warehouse_id = application_row.warehouse_id
     and a.area_type_code = 'truck_entrance'
  on conflict do nothing;

  update public.rfid_pool set status = 'assigned', updated_at = now() where id = rfid_row.id;
  insert into public.member_application_rfid_assignments (application_id, rfid_pool_id)
  values (application_row.id, rfid_row.id)
  on conflict (application_id) do update set rfid_pool_id = excluded.rfid_pool_id;
  update public.warehouse_member_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = application_row.id;
end;
$$;

revoke all on function public.finalize_driver_application(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.finalize_driver_application(uuid, uuid, text, text, text) to authenticated;
