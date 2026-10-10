-- Keep assigned drivers able to authorize and view their plate-only truck
-- access, including trucks created before assignment added permissions.

insert into public.access_permissions (warehouse_id, area_id, staff_member_id, truck_id)
select t.warehouse_id, a.id, null, t.id
from public.trucks t
join public.warehouse_areas a
  on a.warehouse_id = t.warehouse_id
 and a.area_type_code = 'truck_entrance'
where t.current_driver_id is not null
on conflict do nothing;

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
    or exists (
      select 1
        from public.trucks t
        join public.drivers d on d.id = t.current_driver_id
       where t.id = access_logs.truck_id
         and d.profile_id = auth.uid()
    )
  );

create or replace function public.assign_driver_to_truck(
  p_driver_id uuid,
  p_truck_id uuid
)
returns public.trucks
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_warehouse_id uuid;
  truck_warehouse_id uuid;
  driver_is_active boolean;
  truck_is_active boolean;
  existing_driver_truck_id uuid;
  existing_truck_driver_id uuid;
  assigned_truck public.trucks;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select d.warehouse_id, d.is_active
    into driver_warehouse_id, driver_is_active
    from public.drivers d
   where d.id = p_driver_id
     and public.is_warehouse_owner(d.warehouse_id)
   for update;
  if driver_warehouse_id is null then raise exception 'driver_not_owned'; end if;
  if not driver_is_active then raise exception 'driver_inactive'; end if;

  select t.warehouse_id, t.is_active, t.current_driver_id
    into truck_warehouse_id, truck_is_active, existing_truck_driver_id
    from public.trucks t
   where t.id = p_truck_id
     and public.is_warehouse_owner(t.warehouse_id)
   for update;
  if truck_warehouse_id is null then raise exception 'truck_not_owned'; end if;
  if truck_warehouse_id <> driver_warehouse_id then raise exception 'cross_warehouse_assignment'; end if;
  if not truck_is_active then raise exception 'truck_inactive'; end if;
  if existing_truck_driver_id is not null then raise exception 'truck_already_assigned'; end if;

  select t.id
    into existing_driver_truck_id
    from public.trucks t
   where t.current_driver_id = p_driver_id
   for update;
  if existing_driver_truck_id is not null then raise exception 'driver_already_assigned'; end if;

  update public.trucks t
     set current_driver_id = p_driver_id
   where t.id = p_truck_id
  returning * into assigned_truck;

  insert into public.access_permissions (warehouse_id, area_id, staff_member_id, truck_id)
  select assigned_truck.warehouse_id, a.id, null, assigned_truck.id
    from public.warehouse_areas a
   where a.warehouse_id = assigned_truck.warehouse_id
     and a.area_type_code = 'truck_entrance'
  on conflict do nothing;

  return assigned_truck;
end;
$$;
