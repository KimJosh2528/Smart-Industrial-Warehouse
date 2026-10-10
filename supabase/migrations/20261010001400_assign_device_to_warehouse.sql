-- Allow the Father Admin to link an unassigned inventory device to a warehouse.
-- Provisioning remains a separate step so the device secret is only generated once.

create or replace function public.assign_device_to_warehouse(
  p_device_id uuid,
  p_warehouse_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  assigned_id uuid;
begin
  if not public.is_father_admin() then
    raise exception 'only_father_admin_may_assign_device';
  end if;

  if not exists (select 1 from public.warehouses where id = p_warehouse_id) then
    raise exception 'warehouse_not_found';
  end if;

  update public.devices
     set warehouse_id = p_warehouse_id,
         is_active = true,
         updated_at = now()
   where id = p_device_id
     and warehouse_id is null
     and lifecycle_status = 'vacant'
   returning id into assigned_id;

  if assigned_id is null then
    raise exception 'device_not_available';
  end if;

  return assigned_id;
end;
$$;

revoke all on function public.assign_device_to_warehouse(uuid, uuid) from public, anon;
grant execute on function public.assign_device_to_warehouse(uuid, uuid) to authenticated;
