-- Staff department foundation. Departments describe staff but do not grant area access.

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  name text not null,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, name),
  unique (warehouse_id, code),
  unique (id, warehouse_id),
  constraint departments_name_not_blank check (length(btrim(name)) > 0),
  constraint departments_code_not_blank check (length(btrim(code)) > 0)
);

alter table public.staff_members
  add column department_id uuid;

alter table public.staff_members
  add constraint staff_members_department_warehouse_fkey
  foreign key (department_id, warehouse_id)
  references public.departments(id, warehouse_id)
  on delete set null (department_id);

create index staff_members_department_id_idx
  on public.staff_members(department_id);

alter table public.departments enable row level security;

create policy departments_select_owned
  on public.departments for select
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));

create policy departments_insert_owned
  on public.departments for insert
  to authenticated
  with check (public.is_warehouse_owner(warehouse_id));

create policy departments_update_owned
  on public.departments for update
  to authenticated
  using (public.is_warehouse_owner(warehouse_id))
  with check (public.is_warehouse_owner(warehouse_id));

create policy departments_delete_owned
  on public.departments for delete
  to authenticated
  using (public.is_warehouse_owner(warehouse_id));
