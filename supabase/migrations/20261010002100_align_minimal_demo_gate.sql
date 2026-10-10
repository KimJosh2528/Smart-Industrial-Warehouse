-- Keep the minimal hardware demo on the exact gate configured in the ESP firmware.
do $$
declare
  target_warehouse uuid;
  target_member uuid;
  target_gate uuid;
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
     and lower(a.name) = lower('Staff Main Entrance Entrance')
     and a.area_type_code = 'staff_entrance'
   limit 1;

  if target_warehouse is null or target_member is null or target_gate is null then
    raise exception 'minimal_demo_gate_missing';
  end if;

  delete from public.access_permissions where staff_member_id = target_member;
  insert into public.access_permissions (warehouse_id, area_id, staff_member_id)
  values (target_warehouse, target_gate, target_member)
  on conflict do nothing;
end;
$$;
