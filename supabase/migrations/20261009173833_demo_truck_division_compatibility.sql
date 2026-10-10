-- Compatibility column for the linked demo truck schema.
alter table public.trucks
  add column if not exists division text;

alter table public.trucks
  drop constraint if exists trucks_division_check;

alter table public.trucks
  add constraint trucks_division_check
  check (division is null or division in ('RECEIVING_INCOMING', 'PICKING_STAGING_OUTGOING'));
