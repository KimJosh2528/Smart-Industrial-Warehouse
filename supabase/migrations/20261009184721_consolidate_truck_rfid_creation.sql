create or replace function public.create_truck_with_rfid(
  p_warehouse_id uuid,
  p_identity_label text,
  p_plate_number text,
  p_division text,
  p_rfid_pool_id uuid
)
returns public.trucks
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_rfid public.rfid_pool;
  created_truck public.trucks;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_warehouse_owner(p_warehouse_id) then raise exception 'warehouse_not_owned'; end if;
  if btrim(coalesce(p_identity_label, '')) = '' then raise exception 'truck_identity_required'; end if;
  if btrim(coalesce(p_plate_number, '')) = '' then raise exception 'truck_plate_required'; end if;
  if p_division not in ('IMPORT', 'EXPORT') then raise exception 'invalid_truck_division'; end if;

  select * into selected_rfid
    from public.rfid_pool
   where id = p_rfid_pool_id
     and warehouse_id = p_warehouse_id
     and credential_scope = 'truck'
     and status = 'vacant'
   for update;
  if selected_rfid.id is null then raise exception 'rfid_not_vacant_or_wrong_warehouse'; end if;

  insert into public.trucks (warehouse_id, identity_label, plate_number, normalized_plate, is_active, division)
  values (p_warehouse_id, btrim(p_identity_label), btrim(p_plate_number), btrim(p_plate_number), true, p_division)
  returning * into created_truck;

  insert into public.access_credentials (warehouse_id, truck_id, credential_type, credential_hash, is_active)
  values (p_warehouse_id, created_truck.id, 'truck_rfid', selected_rfid.uid_hash, true);

  update public.rfid_pool
     set status = 'assigned', updated_at = now()
   where id = selected_rfid.id;

  return created_truck;
end;
$$;

revoke all on function public.create_truck_with_rfid(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.create_truck_with_rfid(uuid, text, text, text, uuid) to authenticated;

-- Repair the single legacy demo truck only when there is one unassigned truck
-- and one vacant truck RFID in the same warehouse.
do $$
declare
  legacy_truck public.trucks;
  legacy_rfid public.rfid_pool;
begin
  select t.* into legacy_truck
    from public.trucks t
   where t.plate_number = 'k143d'
     and not exists (select 1 from public.access_credentials c where c.truck_id = t.id and c.credential_type = 'truck_rfid')
   limit 1;
  select r.* into legacy_rfid
    from public.rfid_pool r
   where legacy_truck.id is not null
     and r.warehouse_id = legacy_truck.warehouse_id
     and r.credential_scope = 'truck'
     and r.status = 'vacant'
   limit 1;
  if legacy_truck.id is not null and legacy_rfid.id is not null then
    insert into public.access_credentials (warehouse_id, truck_id, credential_type, credential_hash, is_active)
    values (legacy_truck.warehouse_id, legacy_truck.id, 'truck_rfid', legacy_rfid.uid_hash, true)
    on conflict do nothing;
    update public.rfid_pool set status = 'assigned', updated_at = now() where id = legacy_rfid.id;
  end if;
end;
$$;
