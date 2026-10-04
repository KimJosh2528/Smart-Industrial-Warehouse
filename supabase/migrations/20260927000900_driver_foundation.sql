-- Driver identity and current truck assignment foundation.
-- No driver records or assignments are created by this migration.

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  display_name text not null,
  driver_code text,
  is_active boolean not null default true,
  profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, warehouse_id),
  constraint drivers_name_not_blank check (length(btrim(display_name)) > 0),
  constraint drivers_code_not_blank check (
    driver_code is null or length(btrim(driver_code)) > 0
  )
);

create unique index drivers_warehouse_id_driver_code_key
  on public.drivers(warehouse_id, driver_code)
  where driver_code is not null;

create unique index drivers_profile_id_key
  on public.drivers(profile_id)
  where profile_id is not null;

create index drivers_warehouse_id_idx
  on public.drivers(warehouse_id);

create index drivers_profile_id_idx
  on public.drivers(profile_id);

alter table public.trucks
  add column current_driver_id uuid;

alter table public.trucks
  add constraint trucks_current_driver_warehouse_fkey
  foreign key (current_driver_id, warehouse_id)
  references public.drivers(id, warehouse_id)
  on delete set null (current_driver_id);

create unique index trucks_current_driver_id_key
  on public.trucks(current_driver_id)
  where current_driver_id is not null;

alter table public.drivers enable row level security;

create policy drivers_select_owned
  on public.drivers for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy drivers_insert_owned
  on public.drivers for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy drivers_update_owned
  on public.drivers for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy drivers_delete_owned
  on public.drivers for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));
