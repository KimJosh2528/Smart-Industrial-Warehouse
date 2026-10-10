-- Simplified functional demo scope:
--   * Staff: one RFID credential and one Staff Main Entrance.
--   * Truck: one plate credential and one Truck Entrance.
--   * One Roll Yard room for sensor readings.
-- Keep historical rows and access logs; only remove obsolete credentials from
-- the active demo path.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.warehouse_areas'::regclass
       and conname = 'warehouse_areas_entrance_category_check'
  ) then
    alter table public.warehouse_areas drop constraint warehouse_areas_entrance_category_check;
  end if;
  alter table public.warehouse_areas
    add constraint warehouse_areas_entrance_category_check check (
      (area_type_code = 'room' and entrance_category is null)
      or (area_type_code = 'staff_entrance' and entrance_category is not null)
      or (area_type_code = 'truck_entrance' and entrance_category in ('import', 'export', 'parking', 'truck_main'))
    );
end;
$$;

do $$
declare
  target_warehouse uuid;
  staff_gate uuid;
  truck_gate uuid;
  roll_yard uuid;
begin
  select id into target_warehouse from public.warehouses order by created_at limit 1;

  select id into staff_gate
    from public.warehouse_areas
   where warehouse_id = target_warehouse and area_type_code = 'staff_entrance'
   order by case when lower(name) like '%staff main%' then 0 else 1 end, name
   limit 1;
  select id into truck_gate
    from public.warehouse_areas
   where warehouse_id = target_warehouse and area_type_code = 'truck_entrance'
   order by name
   limit 1;
  select id into roll_yard
    from public.warehouse_areas
   where warehouse_id = target_warehouse and area_type_code = 'room'
   order by case when lower(name) like '%roll%yard%' then 0 else 1 end, name
   limit 1;

  if staff_gate is not null then
    update public.warehouse_areas set name = 'Staff Main Entrance', entrance_category = 'staff_main', updated_at = now() where id = staff_gate;
  end if;
  if truck_gate is not null then
    update public.warehouse_areas set name = 'Truck Entrance', entrance_category = 'truck_main', updated_at = now() where id = truck_gate;
  end if;
  if roll_yard is not null then
    update public.warehouse_areas set name = 'Roll Yard', entrance_category = null, updated_at = now() where id = roll_yard;
  end if;

  update public.access_credentials set is_active = false, updated_at = now()
   where credential_type in ('truck_rfid', 'truck_pin', 'staff_face', 'guard_rfid', 'guard_face');
  update public.trucks set division = null, updated_at = now();
  update public.staff_members set is_active = false, updated_at = now() where member_type = 'guard';
  update public.camera_face_mappings set is_active = false, updated_at = now();
end;
$$;
