-- Seed the active warehouse's department catalog and add warehouse-scoped
-- management/assignment RPCs. Departments do not grant area permissions.

insert into public.departments (warehouse_id, name, code, is_active)
values
  ('510d7019-02a5-4631-8599-915db9654bb3', 'IT & Systems', 'IT_SYSTEMS', true),
  ('510d7019-02a5-4631-8599-915db9654bb3', 'HR & Personnel', 'HR_PERSONNEL', true),
  ('510d7019-02a5-4631-8599-915db9654bb3', 'Inventory & Operations', 'INVENTORY_OPERATIONS', true),
  ('510d7019-02a5-4631-8599-915db9654bb3', 'Management & Finance', 'MANAGEMENT_FINANCE', true)
on conflict do nothing;

create or replace function public.create_department(
  p_warehouse_id uuid,
  p_name text,
  p_code text
)
returns public.departments
language plpgsql
security definer
set search_path = public
as $$
declare
  created_department public.departments;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_warehouse_owner(p_warehouse_id) then
    raise exception 'warehouse_not_owned';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'department_name_required';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'department_code_required';
  end if;

  insert into public.departments (warehouse_id, name, code)
  values (p_warehouse_id, btrim(p_name), btrim(p_code))
  returning * into created_department;

  return created_department;
end;
$$;

create or replace function public.update_department(
  p_department_id uuid,
  p_name text,
  p_code text
)
returns public.departments
language plpgsql
security definer
set search_path = public
as $$
declare
  department_warehouse_id uuid;
  updated_department public.departments;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'department_name_required';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'department_code_required';
  end if;

  select d.warehouse_id into department_warehouse_id
    from public.departments d
   where d.id = p_department_id
     and public.is_warehouse_owner(d.warehouse_id)
   for update;
  if department_warehouse_id is null then
    raise exception 'department_not_owned';
  end if;

  update public.departments d
     set name = btrim(p_name),
         code = btrim(p_code),
         updated_at = now()
   where d.id = p_department_id
  returning * into updated_department;

  return updated_department;
end;
$$;

create or replace function public.set_department_active(
  p_department_id uuid,
  p_is_active boolean
)
returns public.departments
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_department public.departments;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update public.departments d
     set is_active = p_is_active,
         updated_at = now()
   where d.id = p_department_id
     and public.is_warehouse_owner(d.warehouse_id)
  returning * into updated_department;

  if updated_department.id is null then
    raise exception 'department_not_owned';
  end if;
  return updated_department;
end;
$$;

create or replace function public.assign_staff_department(
  p_staff_member_id uuid,
  p_department_id uuid default null
)
returns table (
  id uuid,
  department_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_warehouse_id uuid;
  department_warehouse_id uuid;
  department_is_active boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select s.warehouse_id into staff_warehouse_id
    from public.staff_members s
   where s.id = p_staff_member_id
     and public.is_warehouse_owner(s.warehouse_id)
   for update;
  if staff_warehouse_id is null then
    raise exception 'staff_member_not_owned';
  end if;

  if p_department_id is not null then
    select d.warehouse_id, d.is_active
      into department_warehouse_id, department_is_active
      from public.departments d
     where d.id = p_department_id
       and public.is_warehouse_owner(d.warehouse_id);
    if department_warehouse_id is null then
      raise exception 'department_not_owned';
    end if;
    if department_warehouse_id <> staff_warehouse_id then
      raise exception 'cross_warehouse_department';
    end if;
    if not department_is_active then
      raise exception 'department_inactive';
    end if;
  end if;

  return query
  update public.staff_members s
     set department_id = p_department_id,
         updated_at = now()
   where s.id = p_staff_member_id
  returning s.id, s.department_id;
end;
$$;

revoke all on function public.create_department(uuid, text, text) from public, anon;
revoke all on function public.update_department(uuid, text, text) from public, anon;
revoke all on function public.set_department_active(uuid, boolean) from public, anon;
revoke all on function public.assign_staff_department(uuid, uuid) from public, anon;

grant execute on function public.create_department(uuid, text, text) to authenticated;
grant execute on function public.update_department(uuid, text, text) to authenticated;
grant execute on function public.set_department_active(uuid, boolean) to authenticated;
grant execute on function public.assign_staff_department(uuid, uuid) to authenticated;
