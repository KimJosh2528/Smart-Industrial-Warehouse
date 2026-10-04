-- Allow a System Admin to rename only the warehouse assigned to that profile.

create or replace function public.rename_my_warehouse(
  target_warehouse_id uuid,
  new_name text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if btrim(coalesce(new_name, '')) = '' then
    raise exception 'warehouse_name_required';
  end if;

  if not public.is_system_admin_for_warehouse(target_warehouse_id) then
    raise exception 'system_admin_not_assigned_to_warehouse';
  end if;

  update public.warehouses
  set name = btrim(new_name)
  where id = target_warehouse_id
    and system_admin_id = auth.uid();

  if not found then
    raise exception 'warehouse_not_found_or_not_assigned';
  end if;
end;
$$;

revoke all on function public.rename_my_warehouse(uuid, text) from public, anon;
grant execute on function public.rename_my_warehouse(uuid, text) to authenticated;
