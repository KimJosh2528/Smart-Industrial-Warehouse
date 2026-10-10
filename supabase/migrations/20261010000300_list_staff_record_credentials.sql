-- Read staff/guard credential metadata through an owned, security-definer
-- boundary. Raw credential values remain hidden.
create or replace function public.list_staff_record_credentials(p_staff_member_id uuid)
returns table (id uuid, credential_type text, is_active boolean)
language sql
security definer
set search_path = public, extensions
as $$
  select c.id, c.credential_type, c.is_active
    from public.access_credentials c
    join public.staff_members s on s.id = c.staff_member_id
   where c.staff_member_id = p_staff_member_id
     and c.truck_id is null
     and public.is_warehouse_owner(s.warehouse_id);
$$;

create or replace function public.list_staff_record_permissions(p_staff_member_id uuid)
returns table (id uuid, area_id uuid, area_type_code text, area_state text)
language sql
security definer
set search_path = public, extensions
as $$
  select p.id, p.area_id, a.area_type_code, a.state
    from public.access_permissions p
    join public.staff_members s on s.id = p.staff_member_id
    join public.warehouse_areas a on a.id = p.area_id and a.warehouse_id = s.warehouse_id
   where p.staff_member_id = p_staff_member_id
     and p.truck_id is null
     and public.is_warehouse_owner(s.warehouse_id);
$$;

create or replace function public.has_staff_face_mapping(p_staff_member_id uuid)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.camera_face_mappings f
      join public.staff_members s on s.id = f.staff_member_id
     where f.staff_member_id = p_staff_member_id
       and f.is_active
       and public.is_warehouse_owner(s.warehouse_id)
  );
$$;

revoke all on function public.list_staff_record_credentials(uuid) from public, anon;
revoke all on function public.list_staff_record_permissions(uuid) from public, anon;
revoke all on function public.has_staff_face_mapping(uuid) from public, anon;
grant execute on function public.list_staff_record_credentials(uuid) to authenticated;
grant execute on function public.list_staff_record_permissions(uuid) to authenticated;
grant execute on function public.has_staff_face_mapping(uuid) to authenticated;
