-- Fire alarm rules: high temp + smoke, sustained smoke, or rapid temperature rise.
-- Keep the decision server-side so the dashboard and hardware share one result.

create or replace function public.record_sensor_reading(
  p_device_id uuid,
  p_area_id uuid,
  p_temperature_c numeric,
  p_humidity_pct numeric,
  p_smoke_value numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  reading_id bigint,
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
  previous_fire_state text;
  previous_temperature numeric;
  previous_recorded_at timestamptz;
  smoke_started_at timestamptz;
  last_smoke_clear_at timestamptz;
  current_state text;
  current_fire_state text := 'OFF';
  current_trigger_reason text;
  reading_id_value bigint;
  transition_created_value boolean := false;
  config_found boolean := false;
  config_row public.room_environment_configs%rowtype;
  high_temperature boolean := false;
  high_smoke boolean := false;
  long_smoke boolean := false;
  sudden_temperature boolean := false;
begin
  if p_temperature_c is null or p_temperature_c < -40 or p_temperature_c > 80
     or p_humidity_pct is null or p_humidity_pct < 0 or p_humidity_pct > 100
     or p_smoke_value is not null and p_smoke_value < 0 then
    raise exception 'invalid sensor reading';
  end if;

  select d.warehouse_id into device_warehouse_id
    from public.devices d
   where d.id = p_device_id and d.is_active = true
   for update;

  if device_warehouse_id is null then
    raise exception 'device not found';
  end if;

  if not exists (
    select 1 from public.warehouse_areas a
     where a.id = p_area_id and a.warehouse_id = device_warehouse_id
       and a.area_type_code = 'room'
  ) then
    raise exception 'room_not_in_device_warehouse';
  end if;

  select * into config_row
    from public.room_environment_configs c
   where c.area_id = p_area_id and c.warehouse_id = device_warehouse_id;
  config_found := found;

  if not config_found then
    insert into public.sensor_readings (
      warehouse_id, area_id, device_id, temperature_c, humidity_pct,
      smoke_value, environmental_state, fire_state, trigger_reason, metadata
    ) values (
      device_warehouse_id, p_area_id, p_device_id, p_temperature_c,
      p_humidity_pct, p_smoke_value, null, 'OFF', null, p_metadata
    ) returning id into reading_id_value;
    return query select reading_id_value, null::text, null::text, 'OFF'::text,
      null::text, false, 'missing'::text;
    return;
  end if;

  select sr.environmental_state, sr.fire_state, sr.temperature_c, sr.recorded_at
    into previous_state, previous_fire_state, previous_temperature, previous_recorded_at
    from public.sensor_readings sr
   where sr.device_id = p_device_id and sr.area_id = p_area_id
   order by sr.recorded_at desc, sr.id desc
   limit 1;

  if config_row.temperature_danger_low_c is not null and p_temperature_c <= config_row.temperature_danger_low_c
     or config_row.temperature_danger_high_c is not null and p_temperature_c >= config_row.temperature_danger_high_c
     or config_row.humidity_danger_low_pct is not null and p_humidity_pct <= config_row.humidity_danger_low_pct
     or config_row.humidity_danger_high_pct is not null and p_humidity_pct >= config_row.humidity_danger_high_pct
     or p_smoke_value is not null and config_row.smoke_danger_value is not null and p_smoke_value >= config_row.smoke_danger_value then
    current_state := 'DANGER';
  elsif config_row.temperature_warning_low_c is not null and p_temperature_c <= config_row.temperature_warning_low_c
     or config_row.temperature_warning_high_c is not null and p_temperature_c >= config_row.temperature_warning_high_c
     or config_row.humidity_warning_low_pct is not null and p_humidity_pct <= config_row.humidity_warning_low_pct
     or config_row.humidity_warning_high_pct is not null and p_humidity_pct >= config_row.humidity_warning_high_pct
     or p_smoke_value is not null and config_row.smoke_warning_value is not null and p_smoke_value >= config_row.smoke_warning_value then
    current_state := 'WARNING';
  else
    current_state := 'NORMAL';
  end if;

  high_temperature := config_row.temperature_danger_high_c is not null
    and p_temperature_c >= config_row.temperature_danger_high_c;
  high_smoke := p_smoke_value is not null
    and config_row.smoke_danger_value is not null
    and p_smoke_value >= config_row.smoke_danger_value;
  sudden_temperature := previous_temperature is not null
    and previous_recorded_at is not null
    and now() - previous_recorded_at <= interval '30 seconds'
    and p_temperature_c - previous_temperature >= 5;

  if high_smoke then
    select max(sr.recorded_at) into last_smoke_clear_at
      from public.sensor_readings sr
     where sr.device_id = p_device_id and sr.area_id = p_area_id
       and (sr.smoke_value is null or sr.smoke_value < config_row.smoke_danger_value);

    select min(sr.recorded_at) into smoke_started_at
      from public.sensor_readings sr
     where sr.device_id = p_device_id and sr.area_id = p_area_id
       and sr.smoke_value >= config_row.smoke_danger_value
       and (last_smoke_clear_at is null or sr.recorded_at > last_smoke_clear_at);

    long_smoke := smoke_started_at is not null
      and config_row.gas_exposure_seconds is not null
      and now() - smoke_started_at >= make_interval(secs => config_row.gas_exposure_seconds);
  end if;

  if high_temperature and high_smoke then
    current_fire_state := 'ON';
    current_trigger_reason := 'High temperature + high smoke';
  elsif long_smoke then
    current_fire_state := 'ON';
    current_trigger_reason := 'Long smoke exposure';
  elsif sudden_temperature then
    current_fire_state := 'ON';
    current_trigger_reason := 'Sudden high temperature';
  elsif previous_fire_state = 'ON' and (high_temperature or high_smoke) then
    current_fire_state := 'ON';
    current_trigger_reason := 'Fire alarm remains active';
  end if;

  insert into public.sensor_readings (
    warehouse_id, area_id, device_id, temperature_c, humidity_pct,
    smoke_value, environmental_state, fire_state, trigger_reason, metadata
  ) values (
    device_warehouse_id, p_area_id, p_device_id, p_temperature_c,
    p_humidity_pct, p_smoke_value, current_state, current_fire_state,
    current_trigger_reason, p_metadata
  ) returning id into reading_id_value;

  transition_created_value := previous_state is not null and previous_state is distinct from current_state;
  return query select reading_id_value, current_state, previous_state,
    current_fire_state, current_trigger_reason, transition_created_value,
    'configured'::text;
end;
$$;

revoke all on function public.record_sensor_reading(uuid, uuid, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.record_sensor_reading(uuid, uuid, numeric, numeric, numeric, jsonb) to service_role;
