-- Keep account claim requests compatible with the original
-- system-admin-only table while supporting staff, guard, and driver records.

alter table public.account_claim_requests
  add column if not exists staff_member_id uuid,
  add column if not exists driver_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_claim_requests_staff_member_id_fkey'
      and conrelid = 'public.account_claim_requests'::regclass
  ) then
    alter table public.account_claim_requests
      add constraint account_claim_requests_staff_member_id_fkey
      foreign key (staff_member_id)
      references public.staff_members(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_claim_requests_driver_id_fkey'
      and conrelid = 'public.account_claim_requests'::regclass
  ) then
    alter table public.account_claim_requests
      add constraint account_claim_requests_driver_id_fkey
      foreign key (driver_id)
      references public.drivers(id)
      on delete cascade;
  end if;
end
$$;

alter table public.account_claim_requests
  drop constraint if exists account_claim_requests_one_target;

alter table public.account_claim_requests
  add constraint account_claim_requests_one_target
  check (
    (system_admin_application_id is not null and staff_member_id is null and driver_id is null)
    or (system_admin_application_id is null and staff_member_id is not null and driver_id is null)
    or (system_admin_application_id is null and staff_member_id is null and driver_id is not null)
  ) not valid;

create index if not exists account_claim_requests_staff_member_idx
  on public.account_claim_requests(staff_member_id)
  where staff_member_id is not null and used_at is null and revoked_at is null;

create index if not exists account_claim_requests_driver_idx
  on public.account_claim_requests(driver_id)
  where driver_id is not null and used_at is null and revoked_at is null;
