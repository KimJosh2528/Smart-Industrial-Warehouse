-- Truck division belongs to the truck identity and remains nullable until
-- existing trucks receive an administrator-approved division.

alter table public.trucks
  add column division text;

alter table public.trucks
  add constraint trucks_division_check
  check (
    division is null
    or division in ('RECEIVING_INCOMING', 'PICKING_STAGING_OUTGOING')
  );
