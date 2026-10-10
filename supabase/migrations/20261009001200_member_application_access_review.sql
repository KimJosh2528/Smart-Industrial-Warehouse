-- Application-time access review. This is separate from final member records
-- and prevents room areas from ever becoming door permissions.

alter table public.warehouse_member_applications
  add column if not exists guard_placement text;

alter table public.warehouse_member_applications
  drop constraint if exists warehouse_member_applications_guard_placement_check;

alter table public.warehouse_member_applications
  add constraint warehouse_member_applications_guard_placement_check
  check (guard_placement is null or guard_placement in ('staff_entrance_guard', 'truck_entrance_guard'));

create table if not exists public.member_application_area_permissions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.warehouse_member_applications(id) on delete cascade,
  area_id uuid not null references public.warehouse_areas(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (application_id, area_id)
);

alter table public.member_application_area_permissions enable row level security;
revoke all on public.member_application_area_permissions from public, anon, authenticated;

create or replace function public.set_member_application_access(
  p_application_id uuid,
  p_guard_placement text default null,
  p_area_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application_row public.warehouse_member_applications;
  area_id uuid;
  area_type text;
  expected_type text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into application_row
    from public.warehouse_member_applications
   where id = p_application_id
     and (
       public.is_father_admin()
       or public.is_system_admin_for_warehouse(warehouse_id)
     )
   for update;
  if application_row.id is null then raise exception 'member_application_not_owned'; end if;
  if application_row.status <> 'pending' then raise exception 'member_application_not_pending'; end if;

  if application_row.requested_role = 'guard' then
    if p_guard_placement not in ('staff_entrance_guard', 'truck_entrance_guard') then
      raise exception 'guard_placement_required';
    end if;
    expected_type := case when p_guard_placement = 'staff_entrance_guard' then 'staff_entrance' else 'truck_entrance' end;
  elsif application_row.requested_role = 'staff' then
    if p_guard_placement is not null then raise exception 'guard_placement_not_allowed'; end if;
    expected_type := 'staff_entrance';
  elsif application_row.requested_role = 'driver' then
    if p_guard_placement is not null then raise exception 'guard_placement_not_allowed'; end if;
    expected_type := 'truck_entrance';
  else
    raise exception 'member_application_role_invalid';
  end if;

  delete from public.member_application_area_permissions where application_id = application_row.id;
  foreach area_id in array coalesce(p_area_ids, '{}') loop
    select a.area_type_code into area_type
      from public.warehouse_areas a
     where a.id = area_id and a.warehouse_id = application_row.warehouse_id;
    if area_type is null or area_type <> expected_type then
      raise exception 'invalid_member_application_area';
    end if;
    insert into public.member_application_area_permissions (application_id, area_id)
    values (application_row.id, area_id);
  end loop;

  update public.warehouse_member_applications
     set guard_placement = p_guard_placement,
         updated_at = now()
   where id = application_row.id;
end;
$$;

drop function if exists public.list_warehouse_member_applications();

create function public.list_warehouse_member_applications()
returns table(
  id uuid,
  requested_role text,
  applicant_name text,
  applicant_email text,
  valid_id_url text,
  facebook_profile_url text,
  requested_warehouse_name text,
  status text,
  camera_opt_in boolean,
  face_capture_status text,
  face_photo_count smallint,
  face_capture_completed_at timestamptz,
  face_deleted_at timestamptz,
  guard_placement text,
  permission_area_ids uuid[],
  rfid_pool_id uuid,
  rfid_uid text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.requested_role, a.applicant_name, a.applicant_email,
         a.valid_id_url, a.facebook_profile_url,
         a.requested_warehouse_name, a.status, a.camera_opt_in,
         a.face_capture_status, a.face_photo_count,
         a.face_capture_completed_at, a.face_deleted_at, a.guard_placement,
         coalesce(array_agg(p.area_id) filter (where p.area_id is not null), '{}'::uuid[]),
         (array_agg(r.id))[1], (array_agg(r.uid_label))[1],
         a.created_at
    from public.warehouse_member_applications a
    left join public.member_application_area_permissions p on p.application_id = a.id
    left join public.member_application_rfid_assignments ra on ra.application_id = a.id
    left join public.rfid_pool r on r.id = ra.rfid_pool_id
   where public.is_father_admin()
      or public.is_system_admin_for_warehouse(a.warehouse_id)
   group by a.id
   order by a.created_at desc;
$$;

revoke all on function public.set_member_application_access(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_member_application_access(uuid, text, uuid[]) to authenticated;
revoke all on function public.list_warehouse_member_applications() from public, anon;
grant execute on function public.list_warehouse_member_applications() to authenticated;
