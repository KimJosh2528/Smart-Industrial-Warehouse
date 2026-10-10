-- Optional face-authentication consent for Staff and Guard applications.
-- Photos are intentionally not stored by this migration; only consent/status
-- metadata is kept until the private-storage capture flow is implemented.

alter table public.warehouse_member_applications
  add column if not exists camera_opt_in boolean not null default false,
  add column if not exists face_capture_status text not null default 'not_requested',
  add column if not exists face_photo_count smallint not null default 0,
  add column if not exists face_capture_completed_at timestamptz,
  add column if not exists face_deleted_at timestamptz;

-- Repair the legacy Facebook URL check created by the intake migration.
alter table public.warehouse_member_applications
  drop constraint if exists warehouse_member_applications_facebook_profile_url_check;

alter table public.warehouse_member_applications
  add constraint warehouse_member_applications_facebook_profile_url_check
  check (facebook_profile_url ~* '^https://(www\.)?facebook\.com/');

alter table public.warehouse_member_applications
  drop constraint if exists warehouse_member_applications_face_capture_status_check;

alter table public.warehouse_member_applications
  add constraint warehouse_member_applications_face_capture_status_check
  check (face_capture_status in ('not_requested', 'pending', 'ready', 'deleted'));

alter table public.warehouse_member_applications
  drop constraint if exists warehouse_member_applications_face_photo_count_check;

alter table public.warehouse_member_applications
  add constraint warehouse_member_applications_face_photo_count_check
  check (face_photo_count between 0 and 5);

create or replace function public.submit_warehouse_member_application_with_camera(
  p_requested_role text,
  p_applicant_name text,
  p_applicant_email text,
  p_valid_id_url text,
  p_facebook_profile_url text,
  p_warehouse_name text,
  p_camera_opt_in boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_warehouse public.warehouses;
  application_id uuid;
  camera_requested boolean := coalesce(p_camera_opt_in, false) and p_requested_role in ('staff', 'guard');
begin
  if p_requested_role not in ('staff', 'guard', 'driver') then raise exception 'member_application_role_invalid'; end if;
  if p_applicant_name is null or length(btrim(p_applicant_name)) < 2 then raise exception 'member_application_name_invalid'; end if;
  if p_applicant_email is null or position('@' in btrim(p_applicant_email)) < 2 then raise exception 'member_application_email_invalid'; end if;
  if p_valid_id_url is null or p_valid_id_url !~* '^https://' then raise exception 'member_application_valid_id_invalid'; end if;
  if p_facebook_profile_url is null or p_facebook_profile_url !~* '^https://(www\.)?facebook\.com/' then raise exception 'member_application_facebook_invalid'; end if;

  select * into target_warehouse
    from public.warehouses
   where lower(name) = lower(btrim(p_warehouse_name))
   limit 1;
  if target_warehouse.id is null then raise exception 'member_application_warehouse_not_found'; end if;

  insert into public.warehouse_member_applications (
    requested_role, applicant_name, applicant_email, valid_id_url,
    facebook_profile_url, requested_warehouse_name, warehouse_id,
    camera_opt_in, face_capture_status
  ) values (
    p_requested_role, btrim(p_applicant_name), lower(btrim(p_applicant_email)),
    btrim(p_valid_id_url), btrim(p_facebook_profile_url), btrim(p_warehouse_name), target_warehouse.id,
    camera_requested, case when camera_requested then 'pending' else 'not_requested' end
  ) returning id into application_id;
  return application_id;
exception
  when unique_violation then raise exception 'member_application_already_pending';
end;
$$;

revoke all on function public.submit_warehouse_member_application_with_camera(text, text, text, text, text, text, boolean) from public, authenticated;
grant execute on function public.submit_warehouse_member_application_with_camera(text, text, text, text, text, text, boolean) to anon, authenticated;

drop function if exists public.list_warehouse_member_applications();

create function public.list_warehouse_member_applications()
returns table(
  id uuid,
  requested_role text,
  applicant_name text,
  applicant_email text,
  requested_warehouse_name text,
  status text,
  camera_opt_in boolean,
  face_capture_status text,
  face_photo_count smallint,
  face_capture_completed_at timestamptz,
  face_deleted_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id,
         a.requested_role,
         a.applicant_name,
         a.applicant_email,
         a.requested_warehouse_name,
         a.status,
         a.camera_opt_in,
         a.face_capture_status,
         a.face_photo_count,
         a.face_capture_completed_at,
         a.face_deleted_at,
         a.created_at
    from public.warehouse_member_applications a
   where public.is_father_admin()
      or public.is_system_admin_for_warehouse(a.warehouse_id)
   order by a.created_at desc;
$$;

revoke all on function public.list_warehouse_member_applications() from public, anon;
grant execute on function public.list_warehouse_member_applications() to authenticated;
