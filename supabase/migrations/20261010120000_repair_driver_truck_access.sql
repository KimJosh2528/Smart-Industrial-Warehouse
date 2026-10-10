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

-- Preserve whichever live assign_driver_to_truck signature is installed. A
-- trigger handles both older and current assignment workflows.
create or replace function public.ensure_truck_entrance_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_driver_id is not null then
    insert into public.access_permissions (warehouse_id, area_id, staff_member_id, truck_id)
    select new.warehouse_id, a.id, null, new.id
      from public.warehouse_areas a
     where a.warehouse_id = new.warehouse_id
       and a.area_type_code = 'truck_entrance'
       and not exists (
         select 1
           from public.access_permissions p
          where p.warehouse_id = new.warehouse_id
            and p.area_id = a.id
            and p.staff_member_id is null
            and p.truck_id = new.id
       );
  end if;
  return new;
end;
$$;

drop trigger if exists trucks_ensure_truck_entrance_permissions on public.trucks;
create trigger trucks_ensure_truck_entrance_permissions
after insert or update of current_driver_id on public.trucks
for each row execute function public.ensure_truck_entrance_permissions();
