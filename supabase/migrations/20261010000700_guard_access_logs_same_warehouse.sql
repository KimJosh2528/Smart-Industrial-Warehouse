-- Guards must see the same warehouse access-log stream as System Admin.
-- Staff and drivers remain limited by their assigned access permissions.

drop policy if exists access_logs_select_member_permission on public.access_logs;
create policy access_logs_select_member_permission on public.access_logs
  for select to authenticated
  using (
    public.is_father_admin()
    or public.is_system_admin_for_warehouse(warehouse_id)
    or exists (
      select 1
        from public.staff_members guard_member
       where guard_member.profile_id = auth.uid()
         and guard_member.member_type = 'guard'
         and guard_member.warehouse_id = access_logs.warehouse_id
    )
    or exists (
      select 1
        from public.access_permissions p
       where p.area_id = access_logs.area_id
         and (p.staff_member_id in (select s.id from public.staff_members s where s.profile_id = auth.uid())
           or p.truck_id in (select t.id from public.trucks t join public.drivers d on d.id = t.current_driver_id where d.profile_id = auth.uid()))
    )
  );
