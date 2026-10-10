drop function if exists public.list_truck_credentials();

create function public.list_truck_credentials()
returns table (
  id uuid,
  truck_id uuid,
  credential_type text,
  uid_label text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select c.id, c.truck_id, c.credential_type, r.uid_label, c.is_active,
         c.created_at, c.updated_at
    from public.access_credentials c
    join public.trucks t on t.id = c.truck_id
    left join public.rfid_pool r
      on r.uid_hash = c.credential_hash
     and r.credential_scope = 'truck'
   where auth.uid() is not null
     and c.truck_id is not null
     and c.staff_member_id is null
     and c.credential_type = 'truck_rfid'
     and public.is_warehouse_owner(t.warehouse_id)
   order by c.created_at, c.id;
$$;

revoke all on function public.list_truck_credentials() from public, anon;
grant execute on function public.list_truck_credentials() to authenticated;
