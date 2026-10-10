-- Finalize the one-user/one-gate demo without rewriting historical audit rows.
-- Import, Export, and Parking rows remain as retired history; the dashboard
-- only exposes the truck_main row.
do $$
declare
  target_warehouse uuid;
  old_driver uuid;
begin
  select id into target_warehouse
    from public.warehouses
   order by created_at
   limit 1;

  update public.warehouse_areas
     set name = 'Truck Main Entrance', entrance_category = 'truck_main', updated_at = now()
   where id = (
     select id from public.warehouse_areas
      where warehouse_id = target_warehouse
        and area_type_code = 'truck_entrance'
      order by case when entrance_category = 'truck_main' then 0 else 1 end,
               case when lower(name) like '%export%' then 0 else 1 end,
               created_at
      limit 1
   );

  select id into old_driver
    from public.drivers
   where warehouse_id = target_warehouse
     and lower(btrim(display_name)) = 'mang kanor'
   limit 1;

  if old_driver is not null then
    update public.trucks
       set current_driver_id = null, division = null, is_active = false, updated_at = now()
     where current_driver_id = old_driver;
    delete from public.drivers where id = old_driver;
  end if;

  update public.trucks set division = null where warehouse_id = target_warehouse;
  update public.access_credentials set is_active = false, updated_at = now()
   where credential_type = 'truck_rfid';
end;
$$;
