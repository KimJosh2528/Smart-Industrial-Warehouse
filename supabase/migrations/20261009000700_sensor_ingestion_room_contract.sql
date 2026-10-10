-- Sensor ingestion contract for real room hardware.
-- The device sends the target room id; the server validates that the room
-- belongs to the device warehouse and reads the room's saved thresholds.

alter table public.sensor_readings
  add column if not exists area_id uuid,
  add column if not exists smoke_value numeric(10,2),
  add column if not exists environmental_state text,
  add column if not exists fire_state text not null default 'OFF',
  add column if not exists trigger_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sensor_readings_area_warehouse_fk'
      and conrelid = 'public.sensor_readings'::regclass
  ) then
    alter table public.sensor_readings
      add constraint sensor_readings_area_warehouse_fk
      foreign key (area_id, warehouse_id)
      references public.warehouse_areas(id, warehouse_id)
      on delete restrict;
  end if;
end;
$$;

alter table public.sensor_readings
  drop constraint if exists sensor_readings_fire_state_check;

alter table public.sensor_readings
  add constraint sensor_readings_fire_state_check
  check (fire_state in ('ON', 'OFF'));

create index if not exists sensor_readings_area_recorded_at_idx
  on public.sensor_readings(area_id, recorded_at desc);

-- PostgreSQL cannot replace a function when its RETURNS TABLE/OUT columns
-- changed. Remove the legacy return shape before installing this contract.
drop function if exists public.record_sensor_reading(uuid, uuid, numeric, numeric, numeric, jsonb);

create or replace function public.record_sensor_reading(
  p_device_id uuid,
  p_area_id uuid,
  p_temperature_c numeric,
  p_humidity_pct numeric,
  p_smoke_value numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  reading_id uuid,
  environmental_state text,
  previous_environmental_state text,
  fire_state text,
  trigger_reason text,
  transition_created boolean,
  configuration_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  device_warehouse_id uuid;
  previous_state text;
  current_state text;
  current_fire_state text := 'OFF';
  current_trigger_reason text;
  reading_uuid uuid;
  transition_created_value boolean := false;
  config_row public.room_environment_configs%rowtype;
begin
  if p_temperature_c is null or p_temperature_c < -40 or p_temperature_c > 80
     or p_humidity_pct is null or p_humidity_pct < 0 or p_humidity_pct > 100
     or p_smoke_value is not null and p_smoke_value < 0 then
    raise exception 'invalid sensor reading';
  end if;

  select d.warehouse_id, d.environmental_state
    into device_warehouse_id, previous_state
    from public.devices d
   where d.id = p_device_id
     and d.is_active = true
   for update;

  if device_warehouse_id is null then
    raise exception 'device not found';
  end if;

  if not exists (
    select 1 from public.warehouse_areas a
     where a.id = p_area_id
       and a.warehouse_id = device_warehouse_id
       and a.area_type_code = 'room'
  ) then
    raise exception 'room_not_in_device_warehouse';
  end if;

  select * into config_row
    from public.room_environment_configs c
   where c.area_id = p_area_id
     and c.warehouse_id = device_warehouse_id;

  if not found then
    insert into public.sensor_readings (
      warehouse_id, area_id, device_id, temperature_c, humidity_pct,
      smoke_value, environmental_state, fire_state, trigger_reason, metadata
    ) values (
      device_warehouse_id, p_area_id, p_device_id, p_temperature_c,
      p_humidity_pct, p_smoke_value, null, 'OFF', null, p_metadata
    ) returning id into reading_uuid;

    return query select reading_uuid, null::text, previous_state, 'OFF'::text,
      null::text, false, 'missing'::text;
    return;
  end if;

  if (config_row.temperature_danger_low_c is not null and p_temperature_c <= config_row.temperature_danger_low_c)
     or (config_row.temperature_danger_high_c is not null and p_temperature_c >= config_row.temperature_danger_high_c)
     or (config_row.humidity_danger_low_pct is not null and p_humidity_pct <= config_row.humidity_danger_low_pct)
     or (config_row.humidity_danger_high_pct is not null and p_humidity_pct >= config_row.humidity_danger_high_pct)
     or (p_smoke_value is not null and config_row.smoke_danger_value is not null and p_smoke_value >= config_row.smoke_danger_value) then
    current_state := 'DANGER';
  elsif (config_row.temperature_warning_low_c is not null and p_temperature_c <= config_row.temperature_warning_low_c)
     or (config_row.temperature_warning_high_c is not null and p_temperature_c >= config_row.temperature_warning_high_c)
     or (config_row.humidity_warning_low_pct is not null and p_humidity_pct <= config_row.humidity_warning_low_pct)
     or (config_row.humidity_warning_high_pct is not null and p_humidity_pct >= config_row.humidity_warning_high_pct)
     or (p_smoke_value is not null and config_row.smoke_warning_value is not null and p_smoke_value >= config_row.smoke_warning_value) then
    current_state := 'WARNING';
  else
    current_state := 'NORMAL';
  end if;

  if current_state = 'DANGER'
     and p_smoke_value is not null
     and config_row.smoke_danger_value is not null
     and p_smoke_value >= config_row.smoke_danger_value
     and config_row.temperature_danger_high_c is not null
     and p_temperature_c >= config_row.temperature_danger_high_c then
    current_fire_state := 'ON';
    current_trigger_reason := 'High temperature + high gas';
  end if;

  insert into public.sensor_readings (
    warehouse_id, area_id, device_id, temperature_c, humidity_pct,
    smoke_value, environmental_state, fire_state, trigger_reason, metadata
  ) values (
    device_warehouse_id, p_area_id, p_device_id, p_temperature_c,
    p_humidity_pct, p_smoke_value, current_state, current_fire_state,
    current_trigger_reason, p_metadata
  ) returning id into reading_uuid;

  if previous_state is not null and previous_state is distinct from current_state then
    transition_created_value := true;
  end if;

  update public.devices
     set environmental_state = current_state,
         updated_at = now()
   where id = p_device_id;

  return query select reading_uuid, current_state, previous_state,
    current_fire_state, current_trigger_reason, transition_created_value,
    'configured'::text;
end;
$$;

revoke all on function public.record_sensor_reading(uuid, uuid, numeric, numeric, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_sensor_reading(uuid, uuid, numeric, numeric, numeric, jsonb)
  to service_role;
