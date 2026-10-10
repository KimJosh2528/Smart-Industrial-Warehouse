-- Keep the configured room thresholds aligned with the Arduino MQ-2 firmware.
-- 450+ is warning; 650+ is danger/fire.
update public.room_environment_configs
   set smoke_warning_value = 450,
       smoke_danger_value = 650,
       updated_at = now();
