-- Approved driver applications must create an approved driver record.
-- Assignment RPCs intentionally reject pending drivers.
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

  insert into public.drivers (warehouse_id, display_name, is_active, status)
  values (application_row.warehouse_id, application_row.applicant_name, true, 'approved')
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
