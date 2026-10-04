-- Secure warehouse-scoped truck management.
-- Truck identity remains protected by the existing registered-identity trigger.

create or replace function public.create_truck(
  p_warehouse_id uuid,
  p_identity_label text,
  p_plate_number text,
  p_division text default null,
  p_is_active boolean default true
)
returns public.trucks
language plpgsql
security definer
set search_path = public
as $$
declare
  created_truck public.trucks;
  normalized_plate_value text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_warehouse_owner(p_warehouse_id) then
    raise exception 'warehouse_not_owned';
  end if;
  if p_identity_label is null or btrim(p_identity_label) = '' then
    raise exception 'truck_identity_required';
  end if;
  if p_plate_number is null or btrim(p_plate_number) = '' then
    raise exception 'truck_plate_required';
  end if;
  if p_division is not null and p_division not in ('RECEIVING_INCOMING', 'PICKING_STAGING_OUTGOING') then
    raise exception 'invalid_truck_division';
  end if;

  -- Existing truck rows use the trimmed plate value as normalized_plate.
  normalized_plate_value := btrim(p_plate_number);

  insert into public.trucks (
    warehouse_id,
    identity_label,
    plate_number,
    normalized_plate,
    is_active,
    current_driver_id,
    division
  )
  values (
    p_warehouse_id,
    btrim(p_identity_label),
    btrim(p_plate_number),
    normalized_plate_value,
    coalesce(p_is_active, true),
    null,
    p_division
  )
  returning * into created_truck;

  return created_truck;
end;
$$;

create or replace function public.update_truck(
  p_truck_id uuid,
  p_identity_label text,
  p_plate_number text,
  p_division text default null,
  p_is_active boolean default null
)
returns public.trucks
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_truck public.trucks;
  updated_truck public.trucks;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_identity_label is null or btrim(p_identity_label) = '' then
    raise exception 'truck_identity_required';
  end if;
  if p_plate_number is null or btrim(p_plate_number) = '' then
    raise exception 'truck_plate_required';
  end if;
  if p_division is not null and p_division not in ('RECEIVING_INCOMING', 'PICKING_STAGING_OUTGOING') then
    raise exception 'invalid_truck_division';
  end if;

  select t.* into existing_truck
    from public.trucks t
   where t.id = p_truck_id
     and public.is_warehouse_owner(t.warehouse_id)
   for update;
  if existing_truck.id is null then
    raise exception 'truck_not_owned';
  end if;

  if btrim(p_plate_number) is distinct from existing_truck.plate_number
     or btrim(p_plate_number) is distinct from existing_truck.normalized_plate then
    raise exception 'truck_identity_immutable';
  end if;

  update public.trucks t
     set identity_label = btrim(p_identity_label),
         division = p_division,
         is_active = coalesce(p_is_active, t.is_active),
         updated_at = now()
   where t.id = p_truck_id
  returning * into updated_truck;

  return updated_truck;
end;
$$;

create or replace function public.set_truck_active(
  p_truck_id uuid,
  p_is_active boolean
)
returns public.trucks
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_truck public.trucks;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_is_active is null then
    raise exception 'truck_active_state_required';
  end if;

  update public.trucks t
     set is_active = p_is_active,
         updated_at = now()
   where t.id = p_truck_id
     and public.is_warehouse_owner(t.warehouse_id)
  returning * into updated_truck;

  if updated_truck.id is null then
    raise exception 'truck_not_owned';
  end if;

  return updated_truck;
end;
$$;

revoke all on function public.create_truck(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.update_truck(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.set_truck_active(uuid, boolean) from public, anon;

grant execute on function public.create_truck(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.update_truck(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_truck_active(uuid, boolean) to authenticated;
