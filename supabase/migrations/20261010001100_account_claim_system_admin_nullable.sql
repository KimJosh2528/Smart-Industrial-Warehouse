-- Account claim requests can target a system-admin application, a staff
-- member, or a driver. The legacy system-admin-only column must therefore
-- allow NULL for staff, guard, and driver requests.

alter table public.account_claim_requests
  alter column system_admin_application_id drop not null;
