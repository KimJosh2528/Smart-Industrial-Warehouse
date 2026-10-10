-- Fix the face enrollment RPC's PL/pgSQL name collision.
-- The returned staff_member_id name was being resolved both as an output
-- variable and as a table column during the upsert.

drop function if exists public.enroll_own_face_mapping(text);

create function public.enroll_own_face_mapping(p_face_label text)
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

  select s.*
    into member
    from public.staff_members as s
   where s.profile_id = auth.uid()
     and s.member_type in ('staff', 'guard')
     and s.is_active
   limit 1;

  if member.id is null then
    raise exception 'staff_or_guard_record_not_found';
  end if;

  if exists (
    select 1
      from public.camera_face_mappings as other_mapping
     where other_mapping.warehouse_id = member.warehouse_id
       and lower(other_mapping.face_label) = lower(normalized_label)
       and other_mapping.staff_member_id <> member.id
       and other_mapping.is_active
  ) then
    raise exception 'face_label_already_assigned';
  end if;

  update public.camera_face_mappings as existing_mapping
     set warehouse_id = member.warehouse_id,
         face_label = normalized_label,
         is_active = true,
         approved_by = auth.uid(),
         approved_at = now(),
         updated_at = now()
   where existing_mapping.staff_member_id = member.id;

  if not found then
    insert into public.camera_face_mappings
      (warehouse_id, staff_member_id, face_label, is_active, approved_by, approved_at, updated_at)
    values
      (member.warehouse_id, member.id, normalized_label, true, auth.uid(), now(), now());
  end if;

  return query
    select mapping.staff_member_id, mapping.face_label, mapping.is_active
      from public.camera_face_mappings as mapping
     where mapping.staff_member_id = member.id;
end;
$$;

revoke all on function public.enroll_own_face_mapping(text) from public, anon;
grant execute on function public.enroll_own_face_mapping(text) to authenticated;
