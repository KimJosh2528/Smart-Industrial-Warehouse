-- Phase 3: Supabase Auth relationship and Row Level Security.
-- No passwords, device secrets, HMAC, API endpoints, or fake users are created.

-- Phase 2 profiles used an application-generated UUID. The profile ID is now
-- the Supabase Auth user ID so auth.uid() is the ownership identity.
alter table public.profiles
  alter column id drop default;

alter table public.profiles
  add constraint profiles_id_auth_users_fk
  foreign key (id) references auth.users(id) on delete cascade;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'User'
    )
  );

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.is_warehouse_owner(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.warehouses w
    where w.id = target_warehouse_id
      and w.owner_id = auth.uid()
  );
$$;

revoke all on function public.is_warehouse_owner(uuid) from public, anon;
grant execute on function public.is_warehouse_owner(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_area_types enable row level security;
alter table public.warehouse_areas enable row level security;
alter table public.devices enable row level security;
alter table public.staff_members enable row level security;
alter table public.trucks enable row level security;
alter table public.access_credentials enable row level security;
alter table public.access_permissions enable row level security;
alter table public.warehouse_emergency_states enable row level security;
alter table public.access_logs enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.safety_events enable row level security;

-- Profiles: users can see and edit only their own profile.
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Static reference data is readable but not writable by dashboard users.
create policy warehouse_area_types_select_authenticated
  on public.warehouse_area_types for select
  to authenticated
  using (true);

-- Warehouses: ownership is direct through owner_id.
create policy warehouses_select_owned
  on public.warehouses for select
  to authenticated
  using (owner_id = auth.uid());

create policy warehouses_insert_owned
  on public.warehouses for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy warehouses_update_owned
  on public.warehouses for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy warehouses_delete_owned
  on public.warehouses for delete
  to authenticated
  using (owner_id = auth.uid());

-- Warehouse-owned operational data. Ownership is checked through the helper
-- so every policy follows the same auth.uid() -> profile -> warehouse path.
create policy warehouse_areas_select_owned
  on public.warehouse_areas for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy warehouse_areas_insert_owned
  on public.warehouse_areas for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy warehouse_areas_update_owned
  on public.warehouse_areas for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy warehouse_areas_delete_owned
  on public.warehouse_areas for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy devices_select_owned
  on public.devices for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy devices_insert_owned
  on public.devices for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy devices_update_owned
  on public.devices for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy devices_delete_owned
  on public.devices for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy staff_members_select_owned
  on public.staff_members for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy staff_members_insert_owned
  on public.staff_members for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy staff_members_update_owned
  on public.staff_members for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy staff_members_delete_owned
  on public.staff_members for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy trucks_select_owned
  on public.trucks for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy trucks_insert_owned
  on public.trucks for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy trucks_update_owned
  on public.trucks for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy trucks_delete_owned
  on public.trucks for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy access_credentials_select_owned
  on public.access_credentials for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy access_credentials_insert_owned
  on public.access_credentials for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy access_credentials_update_owned
  on public.access_credentials for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy access_credentials_delete_owned
  on public.access_credentials for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy access_permissions_select_owned
  on public.access_permissions for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy access_permissions_insert_owned
  on public.access_permissions for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy access_permissions_update_owned
  on public.access_permissions for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy access_permissions_delete_owned
  on public.access_permissions for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy warehouse_emergency_states_select_owned
  on public.warehouse_emergency_states for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

-- Historical access logs are append-only/read-only for dashboard users.
create policy access_logs_select_owned
  on public.access_logs for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy sensor_readings_select_owned
  on public.sensor_readings for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy safety_events_select_owned
  on public.safety_events for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));
