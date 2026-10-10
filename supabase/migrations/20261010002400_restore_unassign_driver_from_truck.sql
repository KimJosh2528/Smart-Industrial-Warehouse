-- Restore the assignment RPC used by Fleet -> Drivers -> Unassign Truck.
create or replace function public.unassign_driver_from_truck(
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
  assigned_driver_id uuid;
  unassigned_truck public.trucks;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select d.warehouse_id
    into driver_warehouse_id
    from public.drivers d
   where d.id = p_driver_id
     and public.is_warehouse_owner(d.warehouse_id)
   for update;

  if driver_warehouse_id is null then
    raise exception 'driver_not_owned';
  end if;

  select t.warehouse_id, t.current_driver_id
    into truck_warehouse_id, assigned_driver_id
    from public.trucks t
   where t.id = p_truck_id
     and public.is_warehouse_owner(t.warehouse_id)
   for update;

  if truck_warehouse_id is null then
    raise exception 'truck_not_owned';
  end if;
  if truck_warehouse_id <> driver_warehouse_id then
    raise exception 'cross_warehouse_assignment';
  end if;
  if assigned_driver_id is distinct from p_driver_id then
    raise exception 'driver_truck_assignment_not_found';
  end if;

  update public.trucks
     set current_driver_id = null,
         updated_at = now()
   where id = p_truck_id
  returning * into unassigned_truck;

  return unassigned_truck;
end;
$$;

revoke all on function public.unassign_driver_from_truck(uuid, uuid) from public, anon;
grant execute on function public.unassign_driver_from_truck(uuid, uuid) to authenticated;
