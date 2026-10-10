-- Separate Staff and Guard interfaces while keeping one warehouse-scoped identity table.
alter table public.staff_members
  add column if not exists member_type text not null default 'staff';

alter table public.staff_members
  drop constraint if exists staff_members_member_type_check;

alter table public.staff_members
  add constraint staff_members_member_type_check
  check (member_type in ('staff', 'guard'));

create index if not exists staff_members_warehouse_member_type_idx
  on public.staff_members (warehouse_id, member_type, display_name);

create or replace function public.create_guard(
  p_warehouse_id uuid,
  p_display_name text,
  p_employee_code text default null,
  p_is_active boolean default true
)
returns public.staff_members
language plpgsql
security definer
set search_path = public
as $$
declare
  created_guard public.staff_members;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_warehouse_owner(p_warehouse_id) then raise exception 'warehouse_not_owned'; end if;
  if p_display_name is null or btrim(p_display_name) = '' then raise exception 'guard_name_required'; end if;
  if p_employee_code is not null and btrim(p_employee_code) = '' then raise exception 'guard_code_invalid'; end if;

  insert into public.staff_members (warehouse_id, display_name, employee_code, is_active, member_type, profile_id)
  values (p_warehouse_id, btrim(p_display_name), nullif(btrim(p_employee_code), ''), coalesce(p_is_active, true), 'guard', null)
  returning * into created_guard;

  return created_guard;
end;
$$;

revoke all on function public.create_guard(uuid, text, text, boolean) from public, anon;
grant execute on function public.create_guard(uuid, text, text, boolean) to authenticated;
