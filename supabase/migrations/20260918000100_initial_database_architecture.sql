-- Phase 2: initial database architecture.
-- This migration intentionally does not create Auth, RLS, API, device secrets,
-- fake accounts, or fake credentials.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouses_name_not_blank check (length(btrim(name)) > 0)
);

create table public.warehouse_area_types (
  code text primary key,
  name text not null unique,
  sort_order smallint not null unique,
  constraint warehouse_area_types_code_not_blank check (length(btrim(code)) > 0)
);

insert into public.warehouse_area_types (code, name, sort_order)
values
  ('truck_entrance', 'Truck Entrance', 1),
  ('staff_entrance', 'Staff Entrance', 2),
  ('staff_room_1', 'Staff Room 1', 3),
  ('staff_room_2', 'Staff Room 2', 4),
  ('staff_room_3', 'Staff Room 3', 5),
  ('staff_room_4', 'Staff Room 4', 6);

create table public.warehouse_areas (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  area_type_code text not null references public.warehouse_area_types(code) on delete restrict,
  state text not null default 'locked',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, area_type_code),
  unique (id, warehouse_id),
  constraint warehouse_areas_state_check check (state in ('locked', 'unlocked', 'emergency_release'))
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  name text not null,
  device_type text not null,
  serial_number text,
  is_active boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, serial_number),
  constraint devices_name_not_blank check (length(btrim(name)) > 0),
  constraint devices_type_check check (device_type in ('controller', 'camera', 'sensor_module', 'access_module', 'other'))
);

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  display_name text not null,
  employee_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, employee_code),
  constraint staff_members_name_not_blank check (length(btrim(display_name)) > 0)
);

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  identity_label text not null,
  plate_number text not null,
  normalized_plate text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, normalized_plate),
  constraint trucks_identity_not_blank check (length(btrim(identity_label)) > 0),
  constraint trucks_plate_not_blank check (length(btrim(plate_number)) > 0)
);

create table public.access_credentials (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete cascade,
  truck_id uuid references public.trucks(id) on delete cascade,
  credential_type text not null,
  credential_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, credential_type, credential_hash),
  constraint access_credentials_owner_check check (
    (staff_member_id is not null and truck_id is null)
    or (staff_member_id is null and truck_id is not null)
  ),
  constraint access_credentials_type_check check (credential_type in ('staff_rfid', 'staff_pin', 'truck_rfid')),
  constraint access_credentials_hash_not_blank check (length(btrim(credential_hash)) > 0)
);

create table public.access_permissions (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  area_id uuid not null,
  staff_member_id uuid references public.staff_members(id) on delete cascade,
  truck_id uuid references public.trucks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (warehouse_id, area_id, staff_member_id, truck_id),
  constraint access_permissions_subject_check check (
    (staff_member_id is not null and truck_id is null)
    or (staff_member_id is null and truck_id is not null)
  ),
  foreign key (area_id, warehouse_id)
    references public.warehouse_areas(id, warehouse_id)
    on delete cascade
);

create table public.warehouse_emergency_states (
  warehouse_id uuid primary key references public.warehouses(id) on delete cascade,
  state text not null default 'normal',
  reason text,
  changed_at timestamptz not null default now(),
  constraint warehouse_emergency_states_state_check check (state in ('normal', 'emergency_release'))
);

create table public.access_logs (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  area_id uuid,
  device_id uuid references public.devices(id) on delete set null,
  credential_id uuid references public.access_credentials(id) on delete set null,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  truck_id uuid references public.trucks(id) on delete set null,
  event_type text not null,
  authentication_method text not null,
  result text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint access_logs_event_type_check check (event_type in (
    'STAFF_RFID_SUCCESS', 'STAFF_RFID_DENIED',
    'STAFF_PIN_SUCCESS', 'STAFF_PIN_DENIED',
    'TRUCK_PLATE_SUCCESS', 'TRUCK_PLATE_DENIED',
    'TRUCK_RFID_SUCCESS', 'TRUCK_RFID_DENIED'
  )),
  constraint access_logs_authentication_method_check check (
    authentication_method in ('staff_rfid', 'staff_pin', 'truck_plate', 'truck_rfid', 'unknown')
  ),
  constraint access_logs_result_check check (result in ('success', 'failure', 'denied')),
  foreign key (area_id, warehouse_id)
    references public.warehouse_areas(id, warehouse_id)
    on delete restrict
);

create table public.sensor_readings (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  area_id uuid,
  device_id uuid references public.devices(id) on delete set null,
  recorded_at timestamptz not null default now(),
  temperature_c numeric(6, 2),
  humidity_pct numeric(5, 2),
  smoke_detected boolean,
  fire_detected boolean,
  metadata jsonb not null default '{}'::jsonb,
  constraint sensor_readings_humidity_check check (humidity_pct is null or humidity_pct between 0 and 100),
  foreign key (area_id, warehouse_id)
    references public.warehouse_areas(id, warehouse_id)
    on delete restrict
);

create table public.safety_events (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  area_id uuid,
  device_id uuid references public.devices(id) on delete set null,
  event_type text not null,
  severity text not null,
  status text not null default 'open',
  emergency_state text not null default 'normal',
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint safety_events_event_type_check check (event_type in (
    'TEMPERATURE_WARNING', 'SMOKE_DETECTED', 'FIRE_EMERGENCY',
    'EMERGENCY_RELEASE_ACTIVE', 'EMERGENCY_CLEARED'
  )),
  constraint safety_events_severity_check check (severity in ('info', 'warning', 'critical')),
  constraint safety_events_status_check check (status in ('open', 'acknowledged', 'resolved')),
  constraint safety_events_emergency_state_check check (emergency_state in ('normal', 'emergency_release')),
  constraint safety_events_resolution_check check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved' and resolved_at is null)
  ),
  foreign key (area_id, warehouse_id)
    references public.warehouse_areas(id, warehouse_id)
    on delete restrict
);

create index warehouses_owner_id_idx on public.warehouses(owner_id);
create index warehouse_areas_warehouse_id_idx on public.warehouse_areas(warehouse_id);
create index devices_warehouse_id_idx on public.devices(warehouse_id);
create index staff_members_warehouse_id_idx on public.staff_members(warehouse_id);
create index trucks_warehouse_id_idx on public.trucks(warehouse_id);
create index access_credentials_staff_member_id_idx on public.access_credentials(staff_member_id);
create index access_credentials_truck_id_idx on public.access_credentials(truck_id);
create index access_permissions_area_id_idx on public.access_permissions(area_id);
create index access_logs_warehouse_occurred_at_idx on public.access_logs(warehouse_id, occurred_at desc);
create index sensor_readings_warehouse_recorded_at_idx on public.sensor_readings(warehouse_id, recorded_at desc);
create index safety_events_warehouse_occurred_at_idx on public.safety_events(warehouse_id, occurred_at desc);
