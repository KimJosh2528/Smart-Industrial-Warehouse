-- Read scope for claimed Staff, Guard, and Driver accounts.
-- Management writes remain System Admin-only.
create or replace function public.is_member_for_warehouse(p_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members s where s.profile_id = auth.uid() and s.warehouse_id = p_warehouse_id)
      or exists (select 1 from public.drivers d where d.profile_id = auth.uid() and d.warehouse_id = p_warehouse_id);
$$;

revoke all on function public.is_member_for_warehouse(uuid) from public, anon;
grant execute on function public.is_member_for_warehouse(uuid) to authenticated;

drop policy if exists warehouses_select_member_scope on public.warehouses;
create policy warehouses_select_member_scope on public.warehouses for select to authenticated
  using (public.is_member_for_warehouse(id));

drop policy if exists warehouse_areas_select_member_scope on public.warehouse_areas;
create policy warehouse_areas_select_member_scope on public.warehouse_areas for select to authenticated
  using (public.is_member_for_warehouse(warehouse_id));

drop policy if exists staff_members_select_member_self on public.staff_members;
create policy staff_members_select_member_self on public.staff_members for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists drivers_select_member_self on public.drivers;
create policy drivers_select_member_self on public.drivers for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists trucks_select_member_scope on public.trucks;
create policy trucks_select_member_scope on public.trucks for select to authenticated
  using (exists (select 1 from public.drivers d where d.profile_id = auth.uid() and d.warehouse_id = trucks.warehouse_id and d.id = trucks.current_driver_id));

drop policy if exists access_permissions_select_member_self on public.access_permissions;
create policy access_permissions_select_member_self on public.access_permissions for select to authenticated
  using (staff_member_id in (select s.id from public.staff_members s where s.profile_id = auth.uid())
      or truck_id in (select t.id from public.trucks t join public.drivers d on d.id = t.current_driver_id where d.profile_id = auth.uid()));

drop policy if exists sensor_readings_select_member_scope on public.sensor_readings;
create policy sensor_readings_select_member_scope on public.sensor_readings for select to authenticated
  using (public.is_member_for_warehouse(warehouse_id));

drop policy if exists safety_events_select_member_scope on public.safety_events;
create policy safety_events_select_member_scope on public.safety_events for select to authenticated
  using (public.is_member_for_warehouse(warehouse_id));

drop policy if exists room_environment_configs_select_member_scope on public.room_environment_configs;
create policy room_environment_configs_select_member_scope on public.room_environment_configs for select to authenticated
  using (public.is_member_for_warehouse(warehouse_id));

drop policy if exists access_logs_select_member_permission on public.access_logs;
create policy access_logs_select_member_permission on public.access_logs for select to authenticated
  using (
    exists (
      select 1
        from public.access_permissions p
       where p.area_id = access_logs.area_id
         and (p.staff_member_id in (select s.id from public.staff_members s where s.profile_id = auth.uid())
           or p.truck_id in (select t.id from public.trucks t join public.drivers d on d.id = t.current_driver_id where d.profile_id = auth.uid()))
    )
  );
