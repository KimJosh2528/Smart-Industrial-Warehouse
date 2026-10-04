-- Secure warehouse-scoped staff creation.
-- New staff members begin unclaimed and receive no credentials or permissions.

create or replace function public.create_staff(
  p_warehouse_id uuid,
  p_display_name text,
  p_employee_code text default null,
  p_department_id uuid default null,
  p_is_active boolean default true
)
returns public.staff_members
language plpgsql
security definer
set search_path = public
as $$
declare
  created_staff public.staff_members;
  department_warehouse_id uuid;
  department_is_active boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_warehouse_owner(p_warehouse_id) then
    raise exception 'warehouse_not_owned';
  end if;

  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'staff_name_required';
  end if;

  if p_employee_code is not null and btrim(p_employee_code) = '' then
    raise exception 'employee_code_invalid';
  end if;

  if p_department_id is not null then
    select d.warehouse_id, d.is_active
      into department_warehouse_id, department_is_active
      from public.departments d
     where d.id = p_department_id
       and public.is_warehouse_owner(d.warehouse_id)
     for update;

    if department_warehouse_id is null then
      raise exception 'department_not_owned';
    end if;
    if department_warehouse_id <> p_warehouse_id then
      raise exception 'cross_warehouse_department';
    end if;
    if not department_is_active then
      raise exception 'department_inactive';
    end if;
  end if;

  insert into public.staff_members (
    warehouse_id,
    display_name,
    employee_code,
    is_active,
    department_id,
    profile_id
  )
  values (
    p_warehouse_id,
    btrim(p_display_name),
    case when p_employee_code is null then null else btrim(p_employee_code) end,
    coalesce(p_is_active, true),
    p_department_id,
    null
  )
  returning * into created_staff;

  return created_staff;
end;
$$;

revoke all on function public.create_staff(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.create_staff(uuid, text, text, uuid, boolean) to authenticated;
