-- Truck identity is created in Fleet > Trucks. Applications only assign an
-- already-registered truck to an approved driver.

update public.trucks
   set division = 'IMPORT'
 where division = 'RECEIVING_INCOMING';

update public.trucks
   set division = 'EXPORT'
 where division = 'PICKING_STAGING_OUTGOING';

alter table public.trucks
  drop constraint if exists trucks_division_check;

alter table public.trucks
  add constraint trucks_division_check
  check (division is null or division in ('IMPORT', 'EXPORT'));

create or replace function public.create_truck(
  p_warehouse_id uuid,
  p_identity_label text,
  p_plate_number text,
  p_division text,
  p_is_active boolean default true
)
returns public.trucks
language plpgsql
security definer
set search_path = public
as $$
declare
  created_truck public.trucks;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_warehouse_owner(p_warehouse_id) then raise exception 'warehouse_not_owned'; end if;
  if p_identity_label is null or btrim(p_identity_label) = '' then raise exception 'truck_identity_required'; end if;
  if p_plate_number is null or btrim(p_plate_number) = '' then raise exception 'truck_plate_required'; end if;
  if p_division not in ('IMPORT', 'EXPORT') then raise exception 'invalid_truck_division'; end if;

  insert into public.trucks (warehouse_id, identity_label, plate_number, normalized_plate, is_active, division)
  values (p_warehouse_id, btrim(p_identity_label), btrim(p_plate_number), btrim(p_plate_number), coalesce(p_is_active, true), p_division)
  returning * into created_truck;
  return created_truck;
end;
$$;

create or replace function public.update_truck(
  p_truck_id uuid,
  p_identity_label text,
  p_plate_number text,
  p_division text,
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
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_identity_label is null or btrim(p_identity_label) = '' then raise exception 'truck_identity_required'; end if;
  if p_plate_number is null or btrim(p_plate_number) = '' then raise exception 'truck_plate_required'; end if;
  if p_division not in ('IMPORT', 'EXPORT') then raise exception 'invalid_truck_division'; end if;

  select t.* into existing_truck
    from public.trucks t
   where t.id = p_truck_id and public.is_warehouse_owner(t.warehouse_id)
   for update;
  if existing_truck.id is null then raise exception 'truck_not_owned'; end if;
  if btrim(p_plate_number) is distinct from existing_truck.plate_number
     or btrim(p_plate_number) is distinct from existing_truck.normalized_plate then
    raise exception 'truck_identity_immutable';
  end if;

  update public.trucks
     set identity_label = btrim(p_identity_label),
         division = p_division,
         is_active = coalesce(p_is_active, is_active),
         updated_at = now()
   where id = p_truck_id
  returning * into updated_truck;
  return updated_truck;
end;
$$;

drop function if exists public.finalize_driver_application(uuid, uuid, text, text, text);

create or replace function public.finalize_driver_application(
  p_application_id uuid,
  p_truck_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application_row public.warehouse_member_applications;
  target_truck public.trucks;
  driver_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into application_row
    from public.warehouse_member_applications
   where id = p_application_id
     and status = 'pending'
     and requested_role = 'driver'
     and (public.is_father_admin() or public.is_system_admin_for_warehouse(warehouse_id))
   for update;
  if application_row.id is null then raise exception 'driver_application_not_owned_or_pending'; end if;

  select * into target_truck
    from public.trucks
   where id = p_truck_id
     and warehouse_id = application_row.warehouse_id
     and is_active = true
     and current_driver_id is null
   for update;
  if target_truck.id is null then raise exception 'truck_not_available_for_assignment'; end if;

  insert into public.drivers (warehouse_id, display_name, is_active)
  values (application_row.warehouse_id, application_row.applicant_name, true)
  returning id into driver_id;

  update public.trucks
     set current_driver_id = driver_id, updated_at = now()
   where id = target_truck.id;

  update public.warehouse_member_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = application_row.id;
end;
$$;

revoke all on function public.finalize_driver_application(uuid, uuid) from public, anon;
grant execute on function public.finalize_driver_application(uuid, uuid) to authenticated;

-- Staff, guard, and driver identities must originate from applications.
revoke all on function public.create_guard(uuid, text, text, boolean) from authenticated;
