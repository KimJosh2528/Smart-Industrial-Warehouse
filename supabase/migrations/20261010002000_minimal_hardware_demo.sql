-- Minimal hardware demo setup:
-- one active user (Kim Joshua), one RFID, one staff gate, and one room.
-- This intentionally does not modify truck records or other users.

do $$
declare
  target_warehouse uuid;
  target_member uuid;
  target_gate uuid;
  target_room uuid;
  -- Kim Joshua's active guard tag. The white card 8bd6f1ca remains inactive.
  target_hash text := encode(extensions.digest(convert_to('b088c45c', 'UTF8'), 'sha256'), 'hex');
begin
  select w.id into target_warehouse
    from public.warehouses w
   where lower(w.name) = lower('Bacongco warehouse')
   limit 1;

  select m.id into target_member
    from public.staff_members m
   where m.warehouse_id = target_warehouse
     and lower(m.display_name) = lower('Kim Joshua')
     and m.is_active = true
   limit 1;

  select a.id into target_gate
    from public.warehouse_areas a
   where a.warehouse_id = target_warehouse
     and a.area_type_code = 'staff_entrance'
     and lower(a.name) = lower('Staff Main Entrance Entrance')
   limit 1;

  select a.id into target_room
    from public.warehouse_areas a
   where a.warehouse_id = target_warehouse
     and a.area_type_code = 'room'
   order by a.name
   limit 1;

  if target_warehouse is null or target_member is null or target_gate is null or target_room is null then
    raise exception 'minimal_hardware_demo_targets_missing';
  end if;

  update public.access_credentials
     set is_active = false, updated_at = now()
   where staff_member_id = target_member
     and credential_type = 'staff_rfid';

  insert into public.access_credentials
    (warehouse_id, staff_member_id, credential_type, credential_hash, is_active)
  values
    (target_warehouse, target_member, 'staff_rfid', target_hash, true)
  on conflict (warehouse_id, credential_type, credential_hash)
  do update set staff_member_id = excluded.staff_member_id,
                is_active = true,
                updated_at = now();

  delete from public.access_permissions
   where staff_member_id = target_member;

  insert into public.access_permissions (warehouse_id, area_id, staff_member_id)
  values (target_warehouse, target_gate, target_member)
  on conflict do nothing;

  comment on table public.access_permissions is
    'Minimal demo currently uses one user and one gate; production may add more permissions.';
end;
$$;
