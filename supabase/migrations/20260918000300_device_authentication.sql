-- Phase 6: server-side device authentication material.
-- Existing device rows may remain unprovisioned until their UID and encrypted
-- secret are added by a controlled provisioning process.

alter table public.devices
  add column device_uid text,
  add column device_secret_encrypted text,
  add column last_nonce_ts bigint,
  add column last_seen_at timestamptz;

alter table public.devices
  add constraint devices_device_uid_format_check
  check (device_uid is null or device_uid ~ '^[A-Za-z0-9._:-]{1,128}$');

create unique index devices_device_uid_unique_idx
  on public.devices (device_uid)
  where device_uid is not null;

comment on column public.devices.device_secret_encrypted is
  'Authenticated-encryption output: base64(Secretbox nonce || ciphertext); never expose to clients.';
comment on column public.devices.last_nonce_ts is
  'Replay watermark. A signed request must advance this value atomically.';
