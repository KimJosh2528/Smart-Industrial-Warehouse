create or replace function public.delete_driver_record(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_warehouse_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select d.warehouse_id into driver_warehouse_id
    from public.drivers d
   where d.id = p_driver_id
     and public.is_warehouse_owner(d.warehouse_id)
   for update;
  if driver_warehouse_id is null then raise exception 'driver_not_owned'; end if;

  -- Keep the shared truck and its RFID record; remove only the driver link.
  update public.trucks
     set current_driver_id = null, updated_at = now()
   where current_driver_id = p_driver_id;
  delete from public.drivers where id = p_driver_id;
end;
$$;

revoke all on function public.delete_driver_record(uuid) from public, anon;
grant execute on function public.delete_driver_record(uuid) to authenticated;
