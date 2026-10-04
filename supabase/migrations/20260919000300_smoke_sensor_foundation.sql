-- Phase 10: generic smoke measurement in the existing Safety Sensor Unit.
-- The value is raw/normalized until the physical sensor model is confirmed.

alter table public.sensor_readings
  add column smoke_value numeric(12, 4);

alter table public.sensor_readings
  add constraint sensor_readings_smoke_value_check
  check (smoke_value is null or smoke_value >= 0);

alter table public.device_safety_config
  add column smoke_warning_value numeric(12, 4),
  add column smoke_danger_value numeric(12, 4);

alter table public.device_safety_config
  add constraint device_safety_config_smoke_threshold_check
  check (
    (smoke_warning_value is null and smoke_danger_value is null)
    or (smoke_warning_value >= 0
        and smoke_danger_value >= 0
        and smoke_warning_value < smoke_danger_value)
  );
