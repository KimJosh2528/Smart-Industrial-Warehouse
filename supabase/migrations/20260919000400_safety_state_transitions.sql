-- Phase 12: atomic environmental state and transition events.

alter table public.devices
  add column environmental_state text;

alter table public.devices
  add constraint devices_environmental_state_check
  check (environmental_state is null or environmental_state in ('NORMAL', 'WARNING', 'DANGER'));

alter table public.safety_events
  drop constraint safety_events_event_type_check;

alter table public.safety_events
  add constraint safety_events_event_type_check
  check (event_type in (
    'TEMPERATURE_WARNING', 'SMOKE_DETECTED', 'FIRE_EMERGENCY',
    'EMERGENCY_RELEASE_ACTIVE', 'EMERGENCY_CLEARED',
    'ENVIRONMENTAL_STATE_CHANGED'
  ));

alter table public.safety_events
  add column previous_environmental_state text,
  add column environmental_state text,
  add column sensor_reading_id uuid references public.sensor_readings(id) on delete set null;

alter table public.safety_events
  add constraint safety_events_previous_environmental_state_check
  check (previous_environmental_state is null or previous_environmental_state in ('NORMAL', 'WARNING', 'DANGER')),
  add constraint safety_events_environmental_state_check
  check (environmental_state is null or environmental_state in ('NORMAL', 'WARNING', 'DANGER'));

-- Browser roles may observe the current state through owner-scoped reads, but
-- only the server-side transition function may update it.
revoke update (environmental_state) on public.devices from anon, authenticated;

create or replace function public.record_sensor_reading(
  p_device_id uuid,
  p_temperature_c numeric,
  p_humidity_pct numeric,
  p_smoke_value numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  reading_id uuid,
  environmental_state text,
  previous_environmental_state text,
  transition_created boolean,
  configuration_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  device_warehouse_id uuid;
  previous_state text;
  current_state text;
  reading_uuid uuid;
  transition_created_value boolean := false;
  temperature_warning numeric;
  temperature_danger numeric;
  humidity_warning numeric;
  humidity_danger numeric;
  smoke_warning numeric;
  smoke_danger numeric;
begin
  if p_temperature_c is null or p_temperature_c < -40 or p_temperature_c > 80
     or p_humidity_pct is null or p_humidity_pct < 0 or p_humidity_pct > 100
     or p_smoke_value is not null and p_smoke_value < 0 then
    raise exception 'invalid sensor reading';
  end if;

  -- Serializes submissions for the same Device. This prevents concurrent
  -- requests from observing the same previous state and duplicating an event.
  select d.warehouse_id, d.environmental_state
    into device_warehouse_id, previous_state
    from public.devices d
   where d.id = p_device_id
   for update;

  if device_warehouse_id is null then
    raise exception 'device not found';
  end if;

  select c.temperature_warning_c,
         c.temperature_danger_c,
         c.humidity_warning_pct,
         c.humidity_danger_pct,
         c.smoke_warning_value,
         c.smoke_danger_value
    into temperature_warning,
         temperature_danger,
         humidity_warning,
         humidity_danger,
         smoke_warning,
         smoke_danger
    from public.device_safety_config c
   where c.device_id = p_device_id;

  if not found then
    insert into public.sensor_readings (
      warehouse_id, device_id, temperature_c, humidity_pct, smoke_value,
      environmental_state, metadata
    ) values (
      device_warehouse_id, p_device_id, p_temperature_c, p_humidity_pct,
      p_smoke_value, null, p_metadata
    ) returning id into reading_uuid;

    return query select reading_uuid, null::text, previous_state, false, 'missing'::text;
    return;
  end if;

  if p_temperature_c >= temperature_danger
     and p_smoke_value is not null
     and smoke_danger is not null
     and p_smoke_value >= smoke_danger then
    current_state := 'DANGER';
  elsif p_temperature_c >= temperature_warning
     or p_humidity_pct >= humidity_warning
     or (p_smoke_value is not null and smoke_warning is not null and p_smoke_value >= smoke_warning) then
    current_state := 'WARNING';
  else
    current_state := 'NORMAL';
  end if;

  insert into public.sensor_readings (
    warehouse_id, device_id, temperature_c, humidity_pct, smoke_value,
    environmental_state, metadata
  ) values (
    device_warehouse_id, p_device_id, p_temperature_c, p_humidity_pct,
    p_smoke_value, current_state, p_metadata
  ) returning id into reading_uuid;

  if previous_state is not null and previous_state is distinct from current_state then
    insert into public.safety_events (
      warehouse_id, device_id, event_type, severity, status, emergency_state,
      previous_environmental_state, environmental_state, sensor_reading_id, metadata
    ) values (
      device_warehouse_id,
      p_device_id,
      'ENVIRONMENTAL_STATE_CHANGED',
      case current_state when 'DANGER' then 'critical' when 'WARNING' then 'warning' else 'info' end,
      'open',
      'normal',
      previous_state,
      current_state,
      reading_uuid,
      p_metadata || jsonb_build_object(
        'transition', previous_state || '->' || current_state,
        'sensor_unit', 'safety_sensor_unit'
      )
    );
    transition_created_value := true;
  end if;

  update public.devices
     set environmental_state = current_state
   where id = p_device_id;

  return query select reading_uuid, current_state, previous_state,
      transition_created_value, 'configured'::text;
end;
$$;

revoke all on function public.record_sensor_reading(uuid, numeric, numeric, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_sensor_reading(uuid, numeric, numeric, numeric, jsonb)
  to service_role;
