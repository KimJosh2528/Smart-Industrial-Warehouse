-- Allow a signed-in Staff/Guard to read only their own face-enrollment status.

create or replace function public.get_own_face_enrollment(p_staff_member_id uuid)
returns table(is_enrolled boolean, face_label text)
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.camera_face_mappings f
     where f.staff_member_id = s.id and f.is_active
  ) as is_enrolled,
  (
    select f.face_label from public.camera_face_mappings f
     where f.staff_member_id = s.id and f.is_active
     order by f.updated_at desc limit 1
  ) as face_label
    from public.staff_members s
   where s.id = p_staff_member_id
     and s.profile_id = auth.uid()
     and s.member_type in ('staff', 'guard');
$$;

revoke all on function public.get_own_face_enrollment(uuid) from public, anon;
grant execute on function public.get_own_face_enrollment(uuid) to authenticated;
