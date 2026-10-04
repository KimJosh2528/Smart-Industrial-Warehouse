-- Phase 9: device-scoped DHT22 thresholds and evaluated reading state.
-- Threshold values are intentionally not seeded; an owner must configure them.

create table public.device_safety_config (
  device_id uuid primary key references public.devices(id) on delete cascade,
  temperature_warning_c numeric(6, 2) not null,
  temperature_danger_c numeric(6, 2) not null,
  humidity_warning_pct numeric(5, 2) not null,
  humidity_danger_pct numeric(5, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_safety_config_temperature_order_check
    check (temperature_warning_c < temperature_danger_c),
  constraint device_safety_config_humidity_range_check
    check (humidity_warning_pct between 0 and 100
           and humidity_danger_pct between 0 and 100),
  constraint device_safety_config_humidity_order_check
    check (humidity_warning_pct < humidity_danger_pct)
);

alter table public.sensor_readings
  add column environmental_state text;

alter table public.sensor_readings
  add constraint sensor_readings_environmental_state_check
  check (environmental_state is null or environmental_state in ('NORMAL', 'WARNING', 'DANGER'));

alter table public.device_safety_config enable row level security;

create policy device_safety_config_select_owned
  on public.device_safety_config for select
  to authenticated
  using (exists (
    select 1
    from public.devices d
    where d.id = device_id
      and public.is_warehouse_owner(d.warehouse_id)
  ));

create policy device_safety_config_insert_owned
  on public.device_safety_config for insert
  to authenticated
  with check (exists (
    select 1
    from public.devices d
    where d.id = device_id
      and public.is_warehouse_owner(d.warehouse_id)
  ));

create policy device_safety_config_update_owned
  on public.device_safety_config for update
  to authenticated
  using (exists (
    select 1
    from public.devices d
    where d.id = device_id
      and public.is_warehouse_owner(d.warehouse_id)
  ))
  with check (exists (
    select 1
    from public.devices d
    where d.id = device_id
      and public.is_warehouse_owner(d.warehouse_id)
  ));

create policy device_safety_config_delete_owned
  on public.device_safety_config for delete
  to authenticated
  using (exists (
    select 1
    from public.devices d
    where d.id = device_id
      and public.is_warehouse_owner(d.warehouse_id)
  ));

create index device_safety_config_device_id_idx
  on public.device_safety_config(device_id);
