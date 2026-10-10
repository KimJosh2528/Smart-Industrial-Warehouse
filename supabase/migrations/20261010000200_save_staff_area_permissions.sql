-- Save the complete doorlock entrance selection for one staff/guard record.
-- The operation is atomic: selected areas become the full current set.
create or replace function public.save_staff_area_permissions(
  p_staff_member_id uuid,
  p_area_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  staff_warehouse_id uuid;
  area_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select s.warehouse_id into staff_warehouse_id
    from public.staff_members s
   where s.id = p_staff_member_id
     and public.is_warehouse_owner(s.warehouse_id)
   for update;
  if staff_warehouse_id is null then raise exception 'staff_member_not_owned'; end if;

  foreach area_id in array coalesce(p_area_ids, '{}') loop
    if not exists (
      select 1 from public.warehouse_areas a
       where a.id = area_id and a.warehouse_id = staff_warehouse_id
    ) then
      raise exception 'area_not_owned';
    end if;
  end loop;

  delete from public.access_permissions
   where staff_member_id = p_staff_member_id
     and truck_id is null;

  foreach area_id in array coalesce(p_area_ids, '{}') loop
    insert into public.access_permissions (warehouse_id, area_id, staff_member_id)
    values (staff_warehouse_id, area_id, p_staff_member_id)
    on conflict do nothing;
  end loop;
end;
$$;

revoke all on function public.save_staff_area_permissions(uuid, uuid[]) from public, anon;
grant execute on function public.save_staff_area_permissions(uuid, uuid[]) to authenticated;
