-- Finalize a Staff/Guard application in one atomic action.
-- This creates the member record, assigns the RFID, copies entrance
-- permissions, and removes the application from the pending review list.

create or replace function public.finalize_member_application(
  p_application_id uuid,
  p_rfid_pool_id uuid,
  p_guard_placement text default null,
  p_area_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  application_row public.warehouse_member_applications;
  rfid_row public.rfid_pool;
  member_id uuid;
  area_id uuid;
  area_type text;
  expected_type text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into application_row
    from public.warehouse_member_applications
   where id = p_application_id
     and status = 'pending'
     and (public.is_father_admin() or public.is_system_admin_for_warehouse(warehouse_id))
   for update;
  if application_row.id is null then raise exception 'member_application_not_owned_or_pending'; end if;
  if application_row.requested_role = 'driver' then raise exception 'driver_requires_truck_assignment'; end if;

  if application_row.requested_role = 'guard' then
    if p_guard_placement not in ('staff_entrance_guard', 'truck_entrance_guard') then raise exception 'guard_placement_required'; end if;
    expected_type := case when p_guard_placement = 'staff_entrance_guard' then 'staff_entrance' else 'truck_entrance' end;
  else
    if p_guard_placement is not null then raise exception 'guard_placement_not_allowed'; end if;
    expected_type := 'staff_entrance';
  end if;

  select * into rfid_row
    from public.rfid_pool
   where id = p_rfid_pool_id
     and warehouse_id = application_row.warehouse_id
     and status in ('vacant', 'reserved')
     and credential_scope = application_row.requested_role
   for update;
  if rfid_row.id is null then raise exception 'rfid_not_vacant_or_wrong_scope'; end if;

  foreach area_id in array coalesce(p_area_ids, '{}') loop
    select a.area_type_code into area_type
      from public.warehouse_areas a
     where a.id = area_id and a.warehouse_id = application_row.warehouse_id;
    if area_type is null or area_type <> expected_type then raise exception 'invalid_member_application_area'; end if;
  end loop;

  insert into public.staff_members (warehouse_id, display_name, employee_code, is_active, member_type, profile_id)
  values (application_row.warehouse_id, application_row.applicant_name, null, true, application_row.requested_role, null)
  returning id into member_id;

  insert into public.access_credentials (warehouse_id, staff_member_id, credential_type, credential_hash, is_active)
  values (application_row.warehouse_id, member_id, 'staff_rfid', rfid_row.uid_hash, true);

  insert into public.access_permissions (warehouse_id, area_id, staff_member_id)
  select application_row.warehouse_id, p.area_id, member_id
    from public.member_application_area_permissions p
   where p.application_id = application_row.id
  on conflict do nothing;

  delete from public.access_permissions where staff_member_id = member_id;
  foreach area_id in array coalesce(p_area_ids, '{}') loop
    insert into public.access_permissions (warehouse_id, area_id, staff_member_id)
    values (application_row.warehouse_id, area_id, member_id)
    on conflict do nothing;
  end loop;

  update public.rfid_pool set status = 'assigned', updated_at = now() where id = rfid_row.id;
  insert into public.member_application_rfid_assignments (application_id, rfid_pool_id)
  values (application_row.id, rfid_row.id)
  on conflict (application_id) do update set rfid_pool_id = excluded.rfid_pool_id;

  update public.warehouse_member_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         guard_placement = p_guard_placement, updated_at = now()
   where id = application_row.id;
end;
$$;

revoke all on function public.finalize_member_application(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.finalize_member_application(uuid, uuid, text, uuid[]) to authenticated;
