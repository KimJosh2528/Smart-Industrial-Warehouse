-- Harden role and warehouse assignment changes.
-- No role or warehouse assignment is performed by this migration.

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

  if new.system_admin_id is not null
     and auth.uid() is not null
     and not public.is_father_admin() then
    raise exception 'only_father_admin_may_assign_system_admin';
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

create or replace function public.validate_system_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_father_admin() then
    raise exception 'only_father_admin_may_change_platform_role';
  end if;

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
