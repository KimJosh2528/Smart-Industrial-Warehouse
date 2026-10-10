-- Mark a selected vacant truck RFID as assigned after its encrypted credential is created.
create or replace function public.assign_truck_rfid_pool(p_truck_id uuid, p_uid_label text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  truck_warehouse_id uuid;
  rfid_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select t.warehouse_id into truck_warehouse_id
    from public.trucks t
   where t.id = p_truck_id
     and public.is_warehouse_owner(t.warehouse_id)
   for update;
  if truck_warehouse_id is null then raise exception 'truck_not_owned'; end if;

  select r.id into rfid_id
    from public.rfid_pool r
   where r.warehouse_id = truck_warehouse_id
     and r.uid_label = lower(btrim(p_uid_label))
     and r.credential_scope = 'truck'
     and r.status = 'vacant'
   for update;
  if rfid_id is null then raise exception 'rfid_not_vacant_or_wrong_warehouse'; end if;

  update public.rfid_pool
     set status = 'assigned', updated_at = now()
   where id = rfid_id;
end;
$$;

revoke all on function public.assign_truck_rfid_pool(uuid, text) from public, anon;
grant execute on function public.assign_truck_rfid_pool(uuid, text) to authenticated;
