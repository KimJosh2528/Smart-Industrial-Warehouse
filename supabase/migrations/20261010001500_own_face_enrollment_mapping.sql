-- Let a signed-in Staff/Guard map the face label already recognized by the
-- approved local camera model to their own warehouse member record.

create or replace function public.enroll_own_face_mapping(p_face_label text)
returns table(staff_member_id uuid, face_label text, is_active boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member public.staff_members;
  normalized_label text := btrim(coalesce(p_face_label, ''));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if normalized_label = '' then
    raise exception 'face_label_required';
  end if;

  select s.* into member
    from public.staff_members s
   where s.profile_id = auth.uid()
     and s.member_type in ('staff', 'guard')
     and s.is_active
   limit 1;

  if member.id is null then
    raise exception 'staff_or_guard_record_not_found';
  end if;

  if exists (
    select 1 from public.camera_face_mappings f
     where f.warehouse_id = member.warehouse_id
       and lower(f.face_label) = lower(normalized_label)
       and f.staff_member_id <> member.id
       and f.is_active
  ) then
    raise exception 'face_label_already_assigned';
  end if;

  insert into public.camera_face_mappings
    (warehouse_id, staff_member_id, face_label, is_active, approved_by, approved_at, updated_at)
  values
    (member.warehouse_id, member.id, normalized_label, true, auth.uid(), now(), now())
  on conflict (staff_member_id) do update
    set warehouse_id = excluded.warehouse_id,
        face_label = excluded.face_label,
        is_active = true,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  return query
    select f.staff_member_id, f.face_label, f.is_active
      from public.camera_face_mappings f
     where f.staff_member_id = member.id;
end;
$$;

revoke all on function public.enroll_own_face_mapping(text) from public, anon;
grant execute on function public.enroll_own_face_mapping(text) to authenticated;
