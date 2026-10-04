-- Department-associated areas are defaults/recommendations only.
-- They never create, update, or delete staff area permissions.

create table public.department_area_defaults (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  department_id uuid not null,
  area_id uuid not null,
  created_at timestamptz not null default now(),
  unique (department_id, area_id),
  foreign key (department_id, warehouse_id)
    references public.departments(id, warehouse_id)
    on delete cascade,
  foreign key (area_id, warehouse_id)
    references public.warehouse_areas(id, warehouse_id)
    on delete cascade
);

create index department_area_defaults_warehouse_id_idx
  on public.department_area_defaults(warehouse_id);
create index department_area_defaults_area_id_idx
  on public.department_area_defaults(area_id);

alter table public.department_area_defaults enable row level security;

create policy department_area_defaults_select_owned
  on public.department_area_defaults for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy department_area_defaults_insert_owned
  on public.department_area_defaults for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy department_area_defaults_delete_owned
  on public.department_area_defaults for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create or replace function public.list_department_area_defaults(
  p_department_id uuid
)
returns table (
  id uuid,
  department_id uuid,
  area_id uuid,
  area_type_code text,
  area_state text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  department_warehouse_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select d.warehouse_id
    into department_warehouse_id
    from public.departments d
   where d.id = p_department_id;
  if department_warehouse_id is null
     or not public.is_warehouse_owner(department_warehouse_id) then
    raise exception 'department_not_owned';
  end if;

  return query
  select d.id, d.department_id, d.area_id, a.area_type_code, a.state, d.created_at
    from public.department_area_defaults d
    join public.warehouse_areas a
      on a.id = d.area_id
     and a.warehouse_id = d.warehouse_id
   where d.department_id = p_department_id
   order by a.area_type_code, d.id;
end;
$$;

create or replace function public.add_department_area_default(
  p_department_id uuid,
  p_area_id uuid
)
returns table (
  id uuid,
  department_id uuid,
  area_id uuid,
  area_type_code text,
  area_state text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  department_warehouse_id uuid;
  area_warehouse_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select d.warehouse_id
    into department_warehouse_id
    from public.departments d
   where d.id = p_department_id;
  if department_warehouse_id is null
     or not public.is_warehouse_owner(department_warehouse_id) then
    raise exception 'department_not_owned';
  end if;

  select a.warehouse_id
    into area_warehouse_id
    from public.warehouse_areas a
   where a.id = p_area_id;
  if area_warehouse_id is null then
    raise exception 'area_not_found';
  end if;
  if area_warehouse_id <> department_warehouse_id then
    raise exception 'cross_warehouse_department_area';
  end if;

  if exists (
    select 1
      from public.department_area_defaults d
     where d.department_id = p_department_id
       and d.area_id = p_area_id
  ) then
    raise exception 'department_area_default_exists';
  end if;

  return query
  insert into public.department_area_defaults (warehouse_id, department_id, area_id)
  values (department_warehouse_id, p_department_id, p_area_id)
  returning
    department_area_defaults.id,
    department_area_defaults.department_id,
    department_area_defaults.area_id,
    (select a.area_type_code from public.warehouse_areas a where a.id = p_area_id),
    (select a.state from public.warehouse_areas a where a.id = p_area_id),
    department_area_defaults.created_at;
end;
$$;

create or replace function public.remove_department_area_default(
  p_department_id uuid,
  p_area_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  department_warehouse_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select d.warehouse_id
    into department_warehouse_id
    from public.departments d
   where d.id = p_department_id;
  if department_warehouse_id is null
     or not public.is_warehouse_owner(department_warehouse_id) then
    raise exception 'department_not_owned';
  end if;

  delete from public.department_area_defaults d
   where d.department_id = p_department_id
     and d.area_id = p_area_id
     and d.warehouse_id = department_warehouse_id;
  return found;
end;
$$;

revoke all on function public.list_department_area_defaults(uuid) from public, anon;
revoke all on function public.add_department_area_default(uuid, uuid) from public, anon;
revoke all on function public.remove_department_area_default(uuid, uuid) from public, anon;
grant execute on function public.list_department_area_defaults(uuid) to authenticated;
grant execute on function public.add_department_area_default(uuid, uuid) to authenticated;
grant execute on function public.remove_department_area_default(uuid, uuid) to authenticated;
