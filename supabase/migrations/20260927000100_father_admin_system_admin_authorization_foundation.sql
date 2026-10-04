-- Authorization foundation for the Father Admin / System Admin model.
-- This migration intentionally does not assign roles or warehouses.
-- owner_id remains as a compatibility bridge until a later data migration.

alter table public.profiles
  add column if not exists role text;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('father_admin', 'system_admin'));

create unique index if not exists profiles_one_father_admin_idx
  on public.profiles (role)
  where role = 'father_admin';

alter table public.warehouses
  add column if not exists system_admin_id uuid;

alter table public.warehouses
  drop constraint if exists warehouses_system_admin_id_fkey;

alter table public.warehouses
  add constraint warehouses_system_admin_id_fkey
  foreign key (system_admin_id) references public.profiles(id) on delete restrict;

alter table public.warehouses
  drop constraint if exists warehouses_system_admin_id_key;

alter table public.warehouses
  add constraint warehouses_system_admin_id_key unique (system_admin_id);

create or replace function public.is_father_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'father_admin'
  );
$$;

create or replace function public.is_system_admin_for_warehouse(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.warehouses w
    join public.profiles p on p.id = w.system_admin_id
    where w.id = target_warehouse_id
      and w.system_admin_id = auth.uid()
      and p.role = 'system_admin'
  );
$$;

revoke all on function public.is_father_admin() from public, anon;
grant execute on function public.is_father_admin() to authenticated;

revoke all on function public.is_system_admin_for_warehouse(uuid) from public, anon;
grant execute on function public.is_system_admin_for_warehouse(uuid) to authenticated;

-- Validate assignments and prevent non-Father-Admin assignment changes.
create or replace function public.validate_system_admin_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.system_admin_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = new.system_admin_id
      and p.role = 'system_admin'
  ) then
    raise exception 'warehouse_system_admin_must_have_system_admin_role';
  end if;

  if tg_op = 'UPDATE'
     and new.system_admin_id is distinct from old.system_admin_id
     and auth.uid() is not null
     and not public.is_father_admin() then
    raise exception 'only_father_admin_may_assign_system_admin';
  end if;

  return new;
end;
$$;

drop trigger if exists warehouses_system_admin_assignment_guard on public.warehouses;
create trigger warehouses_system_admin_assignment_guard
  before insert or update of system_admin_id on public.warehouses
  for each row execute function public.validate_system_admin_assignment();

create or replace function public.validate_system_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and new.role is distinct from 'system_admin'
     and exists (
       select 1 from public.warehouses w
       where w.system_admin_id = new.id
     ) then
    raise exception 'assigned_system_admin_must_keep_system_admin_role';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_system_admin_role_guard on public.profiles;
create trigger profiles_system_admin_role_guard
  before update of role on public.profiles
  for each row execute function public.validate_system_admin_role_change();

-- Compatibility bridge: existing owner_id data remains valid, while new
-- Father Admin and assigned System Admin identities gain the same warehouse
-- authorization path until owner_id is retired in a later migration.
create or replace function public.is_warehouse_owner(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_father_admin()
      or public.is_system_admin_for_warehouse(target_warehouse_id)
      or exists (
        select 1
        from public.warehouses w
        where w.id = target_warehouse_id
          and w.owner_id = auth.uid()
      );
$$;

-- Warehouse visibility and management for the new roles. Existing owner
-- policies remain in place as the migration bridge.
drop policy if exists warehouses_select_system_admin_or_father on public.warehouses;
create policy warehouses_select_system_admin_or_father
  on public.warehouses for select
  to authenticated
  using (public.is_father_admin() or public.is_system_admin_for_warehouse(id));

drop policy if exists warehouses_insert_father on public.warehouses;
create policy warehouses_insert_father
  on public.warehouses for insert
  to authenticated
  with check (public.is_father_admin());

drop policy if exists warehouses_update_system_admin_or_father on public.warehouses;
create policy warehouses_update_system_admin_or_father
  on public.warehouses for update
  to authenticated
  using (public.is_father_admin() or public.is_system_admin_for_warehouse(id))
  with check (public.is_father_admin() or public.is_system_admin_for_warehouse(id));

drop policy if exists warehouses_delete_father on public.warehouses;
create policy warehouses_delete_father
  on public.warehouses for delete
  to authenticated
  using (public.is_father_admin());

-- Father Admin profile visibility/management. Auth user creation remains an
-- Auth operation; this policy does not create Auth users.
drop policy if exists profiles_select_father_admin on public.profiles;
create policy profiles_select_father_admin
  on public.profiles for select
  to authenticated
  using (public.is_father_admin());

drop policy if exists profiles_update_father_admin on public.profiles;
create policy profiles_update_father_admin
  on public.profiles for update
  to authenticated
  using (public.is_father_admin())
  with check (public.is_father_admin());

comment on column public.profiles.role is
  'Platform role: father_admin or system_admin; NULL remains transitional until explicitly assigned.';

comment on column public.warehouses.system_admin_id is
  'Assigned System Admin profile; NULL remains transitional until explicitly assigned.';
