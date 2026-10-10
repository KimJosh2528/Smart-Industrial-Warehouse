-- Read driver records through the same warehouse-owned RPC boundary used by
-- the fleet pages. This keeps the Drivers record visible to authorized admins
-- even when direct table RLS is more restrictive than the truck query.
create or replace function public.list_owned_driver_records()
returns table (
  id uuid,
  warehouse_id uuid,
  display_name text,
  is_active boolean,
  profile_id uuid
)
language sql
security definer
set search_path = public
as $$
  select d.id, d.warehouse_id, d.display_name, d.is_active, d.profile_id
  from public.drivers d
  where auth.uid() is not null
    and public.is_warehouse_owner(d.warehouse_id)
  order by d.display_name;
$$;

revoke all on function public.list_owned_driver_records() from public, anon;
grant execute on function public.list_owned_driver_records() to authenticated;
