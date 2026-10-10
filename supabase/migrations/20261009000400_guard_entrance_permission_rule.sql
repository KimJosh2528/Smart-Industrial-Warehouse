-- Guard permissions may target either entrance family.
-- Staff remains staff-entrance only; trucks remain truck-entrance only.
create or replace function public.enforce_credential_area_type()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  area_code text;
  member_type text;
begin
  select area_type_code into area_code
    from public.warehouse_areas
   where id = new.area_id;

  if area_code is null then raise exception 'area_not_found'; end if;

  if new.staff_member_id is not null then
    select s.member_type into member_type
      from public.staff_members s
     where s.id = new.staff_member_id;

    if member_type = 'staff' and area_code <> 'staff_entrance' then
      raise exception 'staff_requires_staff_entrance';
    elsif member_type = 'guard' and area_code not in ('staff_entrance', 'truck_entrance') then
      raise exception 'guard_requires_entrance';
    elsif member_type is null or member_type not in ('staff', 'guard') then
      raise exception 'staff_member_role_required';
    end if;
  elsif new.truck_id is not null then
    if area_code <> 'truck_entrance' then raise exception 'truck_requires_truck_entrance'; end if;
  else
    raise exception 'credential_owner_required';
  end if;

  return new;
end;
$$;

drop trigger if exists access_permissions_canonical_area_guard on public.access_permissions;
create trigger access_permissions_canonical_area_guard
  before insert or update of area_id, staff_member_id, truck_id
  on public.access_permissions
  for each row execute function public.enforce_credential_area_type();

revoke all on function public.enforce_credential_area_type() from public, anon, authenticated;
