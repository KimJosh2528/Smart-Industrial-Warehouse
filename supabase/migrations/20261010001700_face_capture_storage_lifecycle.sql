-- Face capture lifecycle metadata.
-- Enrolled photos belong to an active Staff/Guard record; draft photos belong
-- only to a pending application until that application is approved or rejected.

alter table public.camera_face_mappings
  add column if not exists face_photo_path text,
  add column if not exists face_photo_mode text not null default 'enrolled';

alter table public.camera_face_mappings
  drop constraint if exists camera_face_mappings_face_photo_mode_check;

alter table public.camera_face_mappings
  add constraint camera_face_mappings_face_photo_mode_check
  check (face_photo_mode in ('enrolled'));

alter table public.warehouse_member_applications
  add column if not exists face_photo_path text,
  add column if not exists face_photo_mode text not null default 'draft';

alter table public.warehouse_member_applications
  drop constraint if exists warehouse_member_applications_face_photo_mode_check;

alter table public.warehouse_member_applications
  add constraint warehouse_member_applications_face_photo_mode_check
  check (face_photo_mode in ('draft', 'enrolled'));

insert into storage.buckets (id, name, public)
values ('face-photos', 'face-photos', false)
on conflict (id) do update set public = false;
