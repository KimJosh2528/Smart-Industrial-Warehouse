-- Staff account foundation: optionally associate one staff member with one
-- Supabase Auth-backed profile. Existing staff remain unclaimed.

alter table public.staff_members
  add column if not exists profile_id uuid;

alter table public.staff_members
  drop constraint if exists staff_members_profile_id_fkey;

alter table public.staff_members
  add constraint staff_members_profile_id_fkey
  foreign key (profile_id)
  references public.profiles(id)
  on delete set null;

create unique index if not exists staff_members_profile_id_key
  on public.staff_members(profile_id)
  where profile_id is not null;
