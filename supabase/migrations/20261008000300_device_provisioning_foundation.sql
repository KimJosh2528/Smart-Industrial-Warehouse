-- Phase 1: device lifecycle and provisioning foundation.
-- Additive only. No production deployment.

alter table public.devices
  add column if not exists lifecycle_status text,
  add column if not exists credential_version integer;

update public.devices
set lifecycle_status = case
  when device_uid is null and device_secret_encrypted is null then 'vacant'
  when is_active then 'active'
  else 'disabled'
end
where lifecycle_status is null;

update public.devices
set credential_version = case
  when device_uid is not null and device_secret_encrypted is not null then 1
  else 0
end
where credential_version is null;

alter table public.devices
  alter column lifecycle_status set default 'vacant',
  alter column lifecycle_status set not null,
  alter column credential_version set default 0,
  alter column credential_version set not null;

alter table public.devices
  add constraint devices_lifecycle_status_check
  check (lifecycle_status in (
    'vacant','provisioning_pending','provisioned','active',
    'disabled','reassignment_pending','revoked','retired'
  ));

alter table public.devices
  add constraint devices_auth_material_pair_check
  check (
    (device_uid is null and device_secret_encrypted is null)
    or (device_uid is not null and device_secret_encrypted is not null)
  );

alter table public.devices
  add constraint devices_credential_version_check
  check (credential_version >= 0);

create unique index if not exists devices_warehouse_name_ci_unique_idx
  on public.devices (warehouse_id, lower(btrim(name)));

create table public.device_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete restrict,
  event_type text not null check (event_type in (
    'provisioned','disabled','enabled','credential_rotated',
    'reassigned','revoked','retired','renamed','firmware_package_issued'
  )),
  actor_user_id uuid references public.profiles(id) on delete set null,
  previous_warehouse_id uuid references public.warehouses(id) on delete set null,
  new_warehouse_id uuid references public.warehouses(id) on delete set null,
  previous_name text,
  new_name text,
  credential_version integer check (credential_version is null or credential_version > 0),
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index device_lifecycle_events_device_created_idx
  on public.device_lifecycle_events (device_id, created_at desc);

create index device_lifecycle_events_actor_created_idx
  on public.device_lifecycle_events (actor_user_id, created_at desc);

alter table public.device_lifecycle_events enable row level security;
revoke all on public.device_lifecycle_events from public, anon, authenticated;

create or replace function public.prevent_registered_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  operation text := current_setting('wareguard.device_identity_operation', true);
begin
  if tg_table_name = 'staff_members' then
    if new.employee_code is distinct from old.employee_code then
      raise exception 'registered staff identity is immutable';
    end if;
  elsif tg_table_name = 'trucks' then
    if new.plate_number is distinct from old.plate_number
       or new.normalized_plate is distinct from old.normalized_plate then
      raise exception 'registered truck identity is immutable';
    end if;
  elsif tg_table_name = 'devices' then
    if operation = 'provision' then
      if old.device_uid is not null or old.device_secret_encrypted is not null then
        raise exception 'device is already provisioned';
      end if;
    elsif operation in ('rotate','reassign') then
      if old.device_uid is null or old.device_secret_encrypted is null then
        raise exception 'device is not provisioned';
      end if;
      if new.device_uid is distinct from old.device_uid then
        raise exception 'device UID is immutable';
      end if;
    elsif new.device_uid is distinct from old.device_uid
       or new.device_secret_encrypted is distinct from old.device_secret_encrypted then
      raise exception 'registered device authentication identity is immutable';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_registered_identity_change() from public, anon, authenticated;

create or replace function public.provision_device(
  p_device_id uuid,
  p_device_secret_encrypted text
)
returns table(device_id uuid, device_uid text, lifecycle_status text, credential_version integer)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare d public.devices%rowtype; v_uid text;
begin
  if auth.uid() is null or not public.is_father_admin() then
    raise exception 'father admin authorization required';
  end if;
  if p_device_secret_encrypted is null or length(btrim(p_device_secret_encrypted)) < 40 then
    raise exception 'invalid encrypted device secret';
  end if;
  select * into d from public.devices where id = p_device_id for update;
  if not found then raise exception 'device not found'; end if;
  if d.device_uid is not null or d.device_secret_encrypted is not null then
    raise exception 'device is already provisioned';
  end if;
  if d.lifecycle_status <> 'vacant' then raise exception 'device is not vacant'; end if;

  v_uid := 'wg-' || replace(gen_random_uuid()::text, '-', '');
  perform set_config('wareguard.device_identity_operation', 'provision', true);
  update public.devices
  set device_uid=v_uid, device_secret_encrypted=btrim(p_device_secret_encrypted),
      credential_version=1, lifecycle_status='provisioned', is_active=false,
      updated_at=now()
  where id=p_device_id;

  insert into public.device_lifecycle_events(
    device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
    previous_name,new_name,credential_version,reason
  ) values (
    p_device_id,'provisioned',auth.uid(),d.warehouse_id,d.warehouse_id,
    d.name,d.name,1,'Initial device authentication material provisioned'
  );

  return query select id,device_uid,lifecycle_status,credential_version
  from public.devices where id=p_device_id;
end;
$$;

revoke all on function public.provision_device(uuid,text) from public, anon, authenticated;
grant execute on function public.provision_device(uuid,text) to authenticated;

create or replace function public.rename_device(p_device_id uuid, p_name text)
returns table(device_id uuid, device_name text)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare d public.devices%rowtype; n text := btrim(coalesce(p_name,'')); ok boolean;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select exists(
    select 1 from public.devices x
    join public.warehouses w on w.id=x.warehouse_id
    where x.id=p_device_id and (public.is_father_admin() or w.system_admin_id=auth.uid())
  ) into ok;
  if not ok then raise exception 'not authorized for this device'; end if;
  if n='' then raise exception 'device name cannot be blank'; end if;

  select * into d from public.devices where id=p_device_id for update;
  if not found then raise exception 'device not found'; end if;
  if lower(btrim(d.name))=lower(n) then return query select d.id,d.name; return; end if;

  update public.devices set name=n,updated_at=now() where id=p_device_id;
  insert into public.device_lifecycle_events(
    device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
    previous_name,new_name,credential_version,reason
  ) values (
    p_device_id,'renamed',auth.uid(),d.warehouse_id,d.warehouse_id,
    d.name,n,d.credential_version,'Device name changed'
  );
  return query select p_device_id,n;
exception when unique_violation then
  raise exception 'device name already exists in this warehouse';
end;
$$;

revoke all on function public.rename_device(uuid,text) from public, anon, authenticated;
grant execute on function public.rename_device(uuid,text) to authenticated;

create or replace function public.rotate_device_credentials(
  p_device_id uuid, p_device_secret_encrypted text, p_reason text default null
)
returns table(device_id uuid,device_uid text,lifecycle_status text,credential_version integer)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare d public.devices%rowtype; v integer;
begin
  if auth.uid() is null or not public.is_father_admin() then
    raise exception 'father admin authorization required';
  end if;
  if p_device_secret_encrypted is null or length(btrim(p_device_secret_encrypted)) < 40 then
    raise exception 'invalid encrypted device secret';
  end if;
  select * into d from public.devices where id=p_device_id for update;
  if not found then raise exception 'device not found'; end if;
  if d.device_uid is null or d.device_secret_encrypted is null then
    raise exception 'device is not provisioned';
  end if;
  if d.lifecycle_status in ('revoked','retired') then
    raise exception 'device cannot be rotated in its current lifecycle state';
  end if;

  v=d.credential_version+1;
  perform set_config('wareguard.device_identity_operation','rotate',true);
  update public.devices
  set device_secret_encrypted=btrim(p_device_secret_encrypted),
      credential_version=v,lifecycle_status='provisioned',is_active=false,
      last_nonce_ts=null,last_seen_at=null,updated_at=now()
  where id=p_device_id;

  insert into public.device_lifecycle_events(
    device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
    previous_name,new_name,credential_version,reason
  ) values (
    p_device_id,'credential_rotated',auth.uid(),d.warehouse_id,d.warehouse_id,
    d.name,d.name,v,coalesce(nullif(btrim(p_reason),''),'Device credentials rotated')
  );
  return query select id,device_uid,lifecycle_status,credential_version
  from public.devices where id=p_device_id;
end;
$$;

revoke all on function public.rotate_device_credentials(uuid,text,text) from public, anon, authenticated;
grant execute on function public.rotate_device_credentials(uuid,text,text) to authenticated;

create or replace function public.reassign_device(
  p_device_id uuid, p_new_warehouse_id uuid, p_new_device_secret_encrypted text,
  p_reason text default null
)
returns table(device_id uuid,device_uid text,warehouse_id uuid,lifecycle_status text,credential_version integer)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare d public.devices%rowtype; v integer;
begin
  if auth.uid() is null or not public.is_father_admin() then
    raise exception 'father admin authorization required';
  end if;
  if p_new_device_secret_encrypted is null or length(btrim(p_new_device_secret_encrypted)) < 40 then
    raise exception 'invalid encrypted device secret';
  end if;
  if not exists(select 1 from public.warehouses where id=p_new_warehouse_id) then
    raise exception 'target warehouse not found';
  end if;

  select * into d from public.devices where id=p_device_id for update;
  if not found then raise exception 'device not found'; end if;
  if d.device_uid is null or d.device_secret_encrypted is null then
    raise exception 'device is not provisioned';
  end if;
  if d.lifecycle_status in ('revoked','retired') then
    raise exception 'device cannot be reassigned from its current lifecycle state';
  end if;

  v=d.credential_version+1;
  perform set_config('wareguard.device_identity_operation','reassign',true);
  update public.devices
  set warehouse_id=p_new_warehouse_id,device_secret_encrypted=btrim(p_new_device_secret_encrypted),
      credential_version=v,lifecycle_status='reassignment_pending',is_active=false,
      last_nonce_ts=null,last_seen_at=null,updated_at=now()
  where id=p_device_id;

  insert into public.device_lifecycle_events(
    device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
    previous_name,new_name,credential_version,reason
  ) values (
    p_device_id,'reassigned',auth.uid(),d.warehouse_id,p_new_warehouse_id,
    d.name,d.name,v,coalesce(nullif(btrim(p_reason),''),'Device reassigned and credentials rotated')
  );
  return query select id,device_uid,warehouse_id,lifecycle_status,credential_version
  from public.devices where id=p_device_id;
end;
$$;

revoke all on function public.reassign_device(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.reassign_device(uuid,uuid,text,text) to authenticated;

create or replace function public.set_device_lifecycle_status(
  p_device_id uuid,p_status text,p_reason text default null
)
returns table(device_id uuid,lifecycle_status text,is_active boolean)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare d public.devices%rowtype; ev text;
begin
  if auth.uid() is null or not public.is_father_admin() then
    raise exception 'father admin authorization required';
  end if;
  if p_status not in ('provisioned','active','disabled','revoked','retired') then
    raise exception 'invalid lifecycle status';
  end if;

  select * into d from public.devices where id=p_device_id for update;
  if not found then raise exception 'device not found'; end if;
  if d.device_uid is null or d.device_secret_encrypted is null then
    raise exception 'device authentication material is required';
  end if;

  update public.devices
  set lifecycle_status=p_status,is_active=(p_status='active'),updated_at=now()
  where id=p_device_id;

  ev=case when p_status='active' then 'enabled'
          when p_status='disabled' then 'disabled'
          when p_status='revoked' then 'revoked'
          when p_status='retired' then 'retired'
          else null end;
  if ev is not null then
    insert into public.device_lifecycle_events(
      device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
      previous_name,new_name,credential_version,reason
    ) values (
      p_device_id,ev,auth.uid(),d.warehouse_id,d.warehouse_id,d.name,d.name,
      d.credential_version,coalesce(nullif(btrim(p_reason),''),'Device lifecycle status changed')
    );
  end if;
  return query select id,lifecycle_status,is_active from public.devices where id=p_device_id;
end;
$$;

revoke all on function public.set_device_lifecycle_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.set_device_lifecycle_status(uuid,text,text) to authenticated;
