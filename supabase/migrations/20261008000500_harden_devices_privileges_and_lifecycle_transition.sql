-- Harden browser access to device credentials and reassert the lifecycle RPC.

revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.devices
  from anon;

revoke all privileges
  on table public.devices
  from authenticated;

grant select (
  id,
  warehouse_id,
  name,
  device_type,
  serial_number,
  is_active,
  capabilities,
  created_at,
  updated_at,
  device_uid,
  last_seen_at,
  environmental_state,
  area_id,
  iot_role,
  doorlock_mode,
  lifecycle_status,
  credential_version
)
  on table public.devices
  to authenticated;

create or replace function public.set_device_lifecycle_status(
  p_device_id uuid,
  p_status text,
  p_reason text default null,
  p_actor_user_id uuid default null
)
returns table(device_id uuid,lifecycle_status text,is_active boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
  actor uuid := coalesce(p_actor_user_id, auth.uid());
  ev text;
begin
  perform private.require_device_provisioning_service();

  if actor is null or not exists (
    select 1 from public.profiles p
    where p.id = actor and p.role = 'father_admin'
  ) then
    raise exception 'father admin actor required';
  end if;

  if p_status not in ('provisioned','active','disabled','revoked','retired') then
    raise exception 'invalid lifecycle status';
  end if;

  select * into d from public.devices where id = p_device_id for update;
  if not found then raise exception 'device not found'; end if;
  if d.device_uid is null or d.device_secret_encrypted is null then
    raise exception 'device authentication material is required';
  end if;

  if not (
    (d.lifecycle_status = 'provisioned' and p_status = 'active')
    or (d.lifecycle_status = 'active' and p_status = 'disabled')
    or (d.lifecycle_status = 'disabled' and p_status = 'active')
    or (d.lifecycle_status = 'active' and p_status = 'revoked')
    or (d.lifecycle_status = 'reassignment_pending' and p_status = 'provisioned')
    or (d.lifecycle_status = 'revoked' and p_status = 'retired')
  ) then
    raise exception 'invalid device lifecycle transition';
  end if;

  update public.devices
  set lifecycle_status = p_status,
      is_active = (p_status = 'active'),
      updated_at = now()
  where id = p_device_id;

  ev := case
    when p_status = 'active' then 'enabled'
    when p_status = 'disabled' then 'disabled'
    when p_status = 'revoked' then 'revoked'
    when p_status = 'retired' then 'retired'
    else null
  end;

  if ev is not null then
    insert into public.device_lifecycle_events (
      device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
      previous_name,new_name,credential_version,reason
    ) values (
      p_device_id,ev,actor,d.warehouse_id,d.warehouse_id,d.name,d.name,
      d.credential_version,coalesce(nullif(btrim(p_reason),''),'Device lifecycle status changed')
    );
  end if;

  return query
  select id,lifecycle_status,is_active
  from public.devices
  where id = p_device_id;
end;
$$;

revoke all on function public.set_device_lifecycle_status(uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.set_device_lifecycle_status(uuid,text,text,uuid)
  to service_role;

-- Read-only verification queries (run manually after applying this migration):
-- select grantee, privilege_type,
--        has_table_privilege(grantee, 'public.devices', privilege_type) as has_privilege
-- from (values ('anon'), ('authenticated'), ('service_role')) as roles(grantee)
-- cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
--                   ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN'))
--   as privileges(privilege_type)
-- order by grantee, privilege_type;

-- select grantee, column_name,
--        has_column_privilege(grantee, 'public.devices', column_name, 'SELECT') as can_select
-- from (values ('anon'), ('authenticated'), ('service_role')) as roles(grantee)
-- cross join (values
--   ('id'), ('warehouse_id'), ('name'), ('device_type'), ('serial_number'),
--   ('is_active'), ('capabilities'), ('created_at'), ('updated_at'),
--   ('device_uid'), ('last_seen_at'), ('environmental_state'), ('area_id'),
--   ('iot_role'), ('doorlock_mode'), ('lifecycle_status'), ('credential_version'),
--   ('device_secret_encrypted'), ('last_nonce_ts')
-- ) as columns(column_name)
-- order by grantee, column_name;
