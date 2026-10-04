-- Phase A: Father Admin-controlled System Admin assignment.
-- This operation does not create users or assign any existing account automatically.

create or replace function public.assign_system_admin(
  target_warehouse_id uuid,
  target_system_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_father_admin() then
    raise exception 'only_father_admin_may_assign_system_admin';
  end if;

  if not exists (
    select 1
    from public.warehouses w
    where w.id = target_warehouse_id
  ) then
    raise exception 'warehouse_not_found';
  end if;

  if target_system_admin_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = target_system_admin_id
      and p.role = 'system_admin'
  ) then
    raise exception 'target_profile_must_have_system_admin_role';
  end if;

  if target_system_admin_id is not null and exists (
    select 1
    from public.warehouses w
    where w.system_admin_id = target_system_admin_id
      and w.id <> target_warehouse_id
  ) then
    raise exception 'system_admin_already_assigned';
  end if;

  update public.warehouses
  set system_admin_id = target_system_admin_id
  where id = target_warehouse_id;
end;
$$;

revoke all on function public.assign_system_admin(uuid, uuid) from public, anon;
grant execute on function public.assign_system_admin(uuid, uuid) to authenticated;
