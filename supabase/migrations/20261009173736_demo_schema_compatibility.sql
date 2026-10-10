-- Compatibility columns for the linked demo schema. These are additive and
-- keep existing records unchanged while allowing the current RPC contracts
-- to operate.

alter table public.staff_members
  add column if not exists employee_code text,
  add column if not exists is_active boolean not null default true;

alter table public.drivers
  add column if not exists is_active boolean not null default true;
