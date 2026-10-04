-- Secure warehouse-scoped driver management RPCs.
-- Driver creation and assignment remain separate from account claiming and credentials.

create or replace function public.create_driver(
  p_warehouse_id uuid,
  p_display_name text,
  p_driver_code text default null,
  p_is_active boolean default true
)
returns public.drivers
language plpgsql
security definer
set search_path = public
as $$
declare
  created_driver public.drivers;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_warehouse_owner(p_warehouse_id) then
    raise exception 'warehouse_not_owned';
  end if;
  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'driver_name_required';
  end if;
  if p_driver_code is not null and btrim(p_driver_code) = '' then
    raise exception 'driver_code_invalid';
  end if;

  insert into public.drivers (
    warehouse_id,
    display_name,
    driver_code,
    is_active,
    profile_id
  )
  values (
    p_warehouse_id,
    btrim(p_display_name),
    case when p_driver_code is null then null else btrim(p_driver_code) end,
    coalesce(p_is_active, true),
    null
  )
  returning * into created_driver;

  return created_driver;
end;
$$;

create or replace function public.update_driver(
  p_driver_id uuid,
  p_display_name text,
  p_driver_code text default null,
  p_is_active boolean default null
)
returns public.drivers
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_warehouse_id uuid;
  updated_driver public.drivers;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'driver_name_required';
  end if;
  if p_driver_code is not null and btrim(p_driver_code) = '' then
    raise exception 'driver_code_invalid';
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

  update public.drivers d
     set display_name = btrim(p_display_name),
         driver_code = case when p_driver_code is null then null else btrim(p_driver_code) end,
         is_active = coalesce(p_is_active, d.is_active),
         updated_at = now()
   where d.id = p_driver_id
  returning * into updated_driver;

  return updated_driver;
end;
$$;

create or replace function public.set_driver_active(
  p_driver_id uuid,
  p_is_active boolean
)
returns public.drivers
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_driver public.drivers;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_is_active is null then
    raise exception 'driver_active_state_required';
  end if;

  update public.drivers d
     set is_active = p_is_active,
         updated_at = now()
   where d.id = p_driver_id
     and public.is_warehouse_owner(d.warehouse_id)
  returning * into updated_driver;

  if updated_driver.id is null then
    raise exception 'driver_not_owned';
  end if;

  return updated_driver;
end;
$$;

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
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select d.warehouse_id, d.is_active
    into driver_warehouse_id, driver_is_active
    from public.drivers d
   where d.id = p_driver_id
     and public.is_warehouse_owner(d.warehouse_id)
   for update;
  if driver_warehouse_id is null then
    raise exception 'driver_not_owned';
  end if;
  if not driver_is_active then
    raise exception 'driver_inactive';
  end if;

  select t.warehouse_id, t.is_active, t.current_driver_id
    into truck_warehouse_id, truck_is_active, existing_truck_driver_id
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
  if not truck_is_active then
    raise exception 'truck_inactive';
  end if;
  if existing_truck_driver_id is not null then
    raise exception 'truck_already_assigned';
  end if;

  select t.id
    into existing_driver_truck_id
    from public.trucks t
   where t.current_driver_id = p_driver_id
   for update;
  if existing_driver_truck_id is not null then
    raise exception 'driver_already_assigned';
  end if;

  update public.trucks t
     set current_driver_id = p_driver_id
   where t.id = p_truck_id
  returning * into assigned_truck;

  return assigned_truck;
end;
$$;

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

  update public.trucks t
     set current_driver_id = null
   where t.id = p_truck_id
  returning * into unassigned_truck;

  return unassigned_truck;
end;
$$;

revoke all on function public.create_driver(uuid, text, text, boolean) from public, anon;
revoke all on function public.update_driver(uuid, text, text, boolean) from public, anon;
revoke all on function public.set_driver_active(uuid, boolean) from public, anon;
revoke all on function public.assign_driver_to_truck(uuid, uuid) from public, anon;
revoke all on function public.unassign_driver_from_truck(uuid, uuid) from public, anon;

grant execute on function public.create_driver(uuid, text, text, boolean) to authenticated;
grant execute on function public.update_driver(uuid, text, text, boolean) to authenticated;
grant execute on function public.set_driver_active(uuid, boolean) to authenticated;
grant execute on function public.assign_driver_to_truck(uuid, uuid) to authenticated;
grant execute on function public.unassign_driver_from_truck(uuid, uuid) to authenticated;
