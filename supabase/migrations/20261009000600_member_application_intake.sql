-- Public applications for Staff, Guard, and Driver.
-- The warehouse is resolved by an exact name match before insertion.
create table if not exists public.warehouse_member_applications (
  id uuid primary key default gen_random_uuid(),
  requested_role text not null check (requested_role in ('staff', 'guard', 'driver')),
  applicant_name text not null,
  applicant_email text not null,
  valid_id_url text not null,
  facebook_profile_url text not null,
  requested_warehouse_name text not null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(applicant_name)) >= 2),
  check (position('@' in applicant_email) > 1),
  check (valid_id_url ~* '^https://'),
  check (facebook_profile_url ~* '^https://(www\\.)?facebook\\.com/')
);

create unique index if not exists warehouse_member_applications_pending_email_key
  on public.warehouse_member_applications (requested_role, lower(applicant_email), warehouse_id)
  where status = 'pending';

alter table public.warehouse_member_applications enable row level security;
revoke all on public.warehouse_member_applications from public, anon, authenticated;

create or replace function public.submit_warehouse_member_application(
  p_requested_role text,
  p_applicant_name text,
  p_applicant_email text,
  p_valid_id_url text,
  p_facebook_profile_url text,
  p_warehouse_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_warehouse public.warehouses;
  application_id uuid;
begin
  if p_requested_role not in ('staff', 'guard', 'driver') then raise exception 'member_application_role_invalid'; end if;
  if p_applicant_name is null or length(btrim(p_applicant_name)) < 2 then raise exception 'member_application_name_invalid'; end if;
  if p_applicant_email is null or position('@' in btrim(p_applicant_email)) < 2 then raise exception 'member_application_email_invalid'; end if;
  if p_valid_id_url is null or p_valid_id_url !~* '^https://' then raise exception 'member_application_valid_id_invalid'; end if;
  if p_facebook_profile_url is null or p_facebook_profile_url !~* '^https://(www\\.)?facebook\\.com/' then raise exception 'member_application_facebook_invalid'; end if;

  select * into target_warehouse from public.warehouses where name = btrim(p_warehouse_name) limit 1;
  if target_warehouse.id is null then raise exception 'member_application_warehouse_not_found'; end if;

  insert into public.warehouse_member_applications (
    requested_role, applicant_name, applicant_email, valid_id_url,
    facebook_profile_url, requested_warehouse_name, warehouse_id
  ) values (
    p_requested_role, btrim(p_applicant_name), lower(btrim(p_applicant_email)),
    btrim(p_valid_id_url), btrim(p_facebook_profile_url), btrim(p_warehouse_name), target_warehouse.id
  ) returning id into application_id;
  return application_id;
exception
  when unique_violation then raise exception 'member_application_already_pending';
end;
$$;

revoke all on function public.submit_warehouse_member_application(text, text, text, text, text, text) from public, authenticated;
grant execute on function public.submit_warehouse_member_application(text, text, text, text, text, text) to anon, authenticated;
