-- Phase 1: device lifecycle and trusted provisioning foundation.
-- Additive foundation. Do not apply to production until reviewed and tested.
--
-- Credential authority:
--   Trusted Edge/server generates and encrypts device secrets.
--   Browser roles never supply or read device credential material.
--   Server-only RPCs consume short-lived, single-use provisioning intents.
--
-- Existing device authentication remains unchanged.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

alter table public.devices
  add column if not exists lifecycle_status text,
  add column if not exists credential_version integer;

-- Metadata-only backfill. Existing UID/secret/warehouse/replay/name/active values
-- are intentionally not changed.
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
  drop constraint if exists devices_lifecycle_status_check;

alter table public.devices
  add constraint devices_lifecycle_status_check
  check (lifecycle_status in (
    'vacant','provisioned','active','disabled',
    'reassignment_pending','revoked','retired'
  ));

alter table public.devices
  drop constraint if exists devices_auth_material_pair_check;

alter table public.devices
  add constraint devices_auth_material_pair_check
  check (
    (device_uid is null and device_secret_encrypted is null)
    or (device_uid is not null and device_secret_encrypted is not null)
  );

alter table public.devices
  drop constraint if exists devices_credential_version_check;

alter table public.devices
  add constraint devices_credential_version_check
  check (credential_version >= 0);

create unique index if not exists devices_warehouse_name_ci_unique_idx
  on public.devices (warehouse_id, lower(btrim(name)));

create table if not exists public.device_lifecycle_events (
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

create index if not exists device_lifecycle_events_device_created_idx
  on public.device_lifecycle_events (device_id, created_at desc);

create index if not exists device_lifecycle_events_actor_created_idx
  on public.device_lifecycle_events (actor_user_id, created_at desc);

alter table public.device_lifecycle_events enable row level security;
revoke all on public.device_lifecycle_events from public, anon, authenticated;

-- Internal one-time provisioning intents. Raw secrets are never stored.
create table if not exists private.device_provisioning_intents (
  id uuid primary key default gen_random_uuid(),
  intent_token_hash text not null unique,
  encrypted_secret_hash text not null,
  device_id uuid not null references public.devices(id) on delete restrict,
  operation text not null check (operation in ('provision','rotate','reassign')),
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  expected_lifecycle_status text not null,
  expected_credential_version integer not null check (expected_credential_version >= 0),
  expected_device_uid text,
  requested_device_uid text,
  target_warehouse_id uuid references public.warehouses(id) on delete restrict,
  reason text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists device_provisioning_intents_device_idx
  on private.device_provisioning_intents (device_id, created_at desc);

create index if not exists device_provisioning_intents_expiry_idx
  on private.device_provisioning_intents (expires_at)
  where consumed_at is null;

revoke all on private.device_provisioning_intents from public, anon, authenticated;

-- Identity trigger: no operation marker/GUC is trusted.
-- Credential transitions are allowed only when OLD -> NEW satisfies the
-- exact structural invariants of a supported provisioning operation.
create or replace function public.prevent_registered_identity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_TABLE_NAME = 'staff_members' then
    if NEW.employee_code is distinct from OLD.employee_code then
      raise exception 'registered staff identity is immutable';
    end if;
  elsif TG_TABLE_NAME = 'trucks' then
    if NEW.plate_number is distinct from OLD.plate_number
       or NEW.normalized_plate is distinct from OLD.normalized_plate then
      raise exception 'registered truck identity is immutable';
    end if;
  elsif TG_TABLE_NAME = 'devices' then
    if NEW.device_uid is null and NEW.device_secret_encrypted is not null
       or NEW.device_uid is not null and NEW.device_secret_encrypted is null then
      raise exception 'device authentication identity must be complete';
    end if;

    if OLD.device_uid is not null
       and NEW.device_uid is distinct from OLD.device_uid then
      raise exception 'device UID is immutable';
    end if;

    if OLD.device_uid is null and NEW.device_uid is not null then
      if OLD.device_secret_encrypted is not null
         or NEW.lifecycle_status <> 'provisioned'
         or NEW.credential_version <> 1
         or NEW.is_active <> false then
        raise exception 'invalid initial device provisioning transition';
      end if;
    elsif OLD.device_uid is not null
       and NEW.device_secret_encrypted is distinct from OLD.device_secret_encrypted then
      if NEW.credential_version <> OLD.credential_version + 1
         or NEW.is_active <> false
         or NEW.lifecycle_status not in ('provisioned','reassignment_pending') then
        raise exception 'invalid device credential rotation transition';
      end if;
    elsif NEW.device_secret_encrypted is distinct from OLD.device_secret_encrypted then
      raise exception 'invalid device authentication transition';
    end if;

    if OLD.device_uid is not null
       and OLD.device_secret_encrypted is not null
       and NEW.device_uid is null then
      raise exception 'registered device authentication identity cannot be cleared';
    end if;
  end if;

  return NEW;
end;
$$;

revoke all on function public.prevent_registered_identity_change() from public, anon, authenticated;

-- Trusted-server check. These RPCs are never granted to browser roles.
create or replace function private.require_device_provisioning_service()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    current_setting('request.jwt.claim.role', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'role'
  );

  if v_role <> 'service_role' then
    raise exception 'trusted provisioning service required';
  end if;
end;
$$;

revoke all on function private.require_device_provisioning_service() from public, anon, authenticated;

create or replace function public.create_device_provisioning_intent(
  p_actor_user_id uuid,
  p_device_id uuid,
  p_operation text,
  p_encrypted_secret text,
  p_requested_device_uid text default null,
  p_target_warehouse_id uuid default null,
  p_reason text default null
)
returns table(intent_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
  token text;
  token_hash text;
  secret_hash text;
  target_warehouse uuid;
  expected_uid text;
  expected_status text;
  expected_version integer;
begin
  perform private.require_device_provisioning_service();

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_user_id
      and p.role = 'father_admin'
  ) then
    raise exception 'father admin actor required';
  end if;

  if p_operation not in ('provision','rotate','reassign') then
    raise exception 'invalid provisioning operation';
  end if;

  if p_encrypted_secret is null or length(btrim(p_encrypted_secret)) < 40 then
    raise exception 'invalid encrypted device secret';
  end if;

  if p_operation = 'provision'
     and (p_requested_device_uid is null
          or p_requested_device_uid !~ '^[A-Za-z0-9._:-]{1,128}$') then
    raise exception 'valid device UID required for initial provisioning';
  end if;

  select * into d
  from public.devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'device not found';
  end if;

  expected_status := d.lifecycle_status;
  expected_version := d.credential_version;
  expected_uid := d.device_uid;

  if p_operation = 'provision' then
    if d.lifecycle_status <> 'vacant'
       or d.device_uid is not null
       or d.device_secret_encrypted is not null
       or d.credential_version <> 0 then
      raise exception 'device is not vacant';
    end if;
    target_warehouse := d.warehouse_id;
  elsif p_operation = 'rotate' then
    if d.lifecycle_status not in ('provisioned','active','disabled')
       or d.device_uid is null
       or d.device_secret_encrypted is null then
      raise exception 'device cannot be rotated in its current lifecycle state';
    end if;
    target_warehouse := d.warehouse_id;
  else
    if d.lifecycle_status not in ('provisioned','active','disabled')
       or d.device_uid is null
       or d.device_secret_encrypted is null then
      raise exception 'device cannot be reassigned in its current lifecycle state';
    end if;
    if p_target_warehouse_id is null
       or not exists (
         select 1 from public.warehouses w where w.id = p_target_warehouse_id
       ) then
      raise exception 'target warehouse not found';
    end if;
    target_warehouse := p_target_warehouse_id;
  end if;

  if p_operation = 'reassign' and target_warehouse = d.warehouse_id then
    raise exception 'reassignment target must differ from current warehouse';
  end if;

  token := encode(gen_random_bytes(32), 'hex');
  token_hash := encode(digest(convert_to(token, 'utf8'), 'sha256'), 'hex');
  secret_hash := encode(digest(convert_to(btrim(p_encrypted_secret), 'utf8'), 'sha256'), 'hex');

  insert into private.device_provisioning_intents (
    intent_token_hash, encrypted_secret_hash, device_id, operation,
    actor_user_id, expected_lifecycle_status, expected_credential_version,
    expected_device_uid, requested_device_uid, target_warehouse_id,
    reason, expires_at
  )
  values (
    token_hash, secret_hash, p_device_id, p_operation,
    p_actor_user_id, expected_status, expected_version,
    expected_uid, nullif(btrim(p_requested_device_uid), ''), target_warehouse,
    nullif(btrim(p_reason), ''), now() + interval '5 minutes'
  );

  return query
  select token, now() + interval '5 minutes';
end;
$$;

revoke all on function public.create_device_provisioning_intent(uuid,uuid,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.create_device_provisioning_intent(uuid,uuid,text,text,text,uuid,text)
  to service_role;

create or replace function public.consume_device_provisioning_intent(
  p_intent_token text,
  p_encrypted_secret text
)
returns table(
  device_id uuid,
  device_uid text,
  warehouse_id uuid,
  lifecycle_status text,
  credential_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  i private.device_provisioning_intents%rowtype;
  d public.devices%rowtype;
  token_hash text;
  secret_hash text;
  next_uid text;
  next_status text;
  next_version integer;
begin
  perform private.require_device_provisioning_service();

  if p_intent_token is null or length(p_intent_token) < 32 then
    raise exception 'invalid provisioning intent';
  end if;
  if p_encrypted_secret is null or length(btrim(p_encrypted_secret)) < 40 then
    raise exception 'invalid encrypted device secret';
  end if;

  token_hash := encode(digest(convert_to(p_intent_token, 'utf8'), 'sha256'), 'hex');
  secret_hash := encode(digest(convert_to(btrim(p_encrypted_secret), 'utf8'), 'sha256'), 'hex');

  select * into i
  from private.device_provisioning_intents
  where intent_token_hash = token_hash
  for update;

  if not found or i.consumed_at is not null or i.expires_at <= now() then
    raise exception 'provisioning intent is invalid or expired';
  end if;

  if i.encrypted_secret_hash <> secret_hash then
    raise exception 'provisioning credential mismatch';
  end if;

  select * into d
  from public.devices
  where id = i.device_id
  for update;

  if not found then
    raise exception 'device not found';
  end if;

  if d.lifecycle_status <> i.expected_lifecycle_status
     or d.credential_version <> i.expected_credential_version
     or d.device_uid is distinct from i.expected_device_uid then
    raise exception 'device changed since provisioning intent was issued';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = i.actor_user_id and p.role = 'father_admin'
  ) then
    raise exception 'father admin actor required';
  end if;

  if i.operation = 'provision' then
    if d.lifecycle_status <> 'vacant'
       or d.device_uid is not null
       or d.device_secret_encrypted is not null then
      raise exception 'device is not vacant';
    end if;
    next_uid := i.requested_device_uid;
    next_status := 'provisioned';
    next_version := 1;

    update public.devices
    set device_uid = next_uid,
        device_secret_encrypted = btrim(p_encrypted_secret),
        credential_version = next_version,
        lifecycle_status = next_status,
        is_active = false,
        updated_at = now()
    where id = d.id;

    insert into public.device_lifecycle_events (
      device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
      previous_name,new_name,credential_version,reason
    ) values (
      d.id,'provisioned',i.actor_user_id,d.warehouse_id,d.warehouse_id,
      d.name,d.name,1,coalesce(i.reason,'Initial device authentication material provisioned')
    );
  elsif i.operation = 'rotate' then
    if d.lifecycle_status not in ('provisioned','active','disabled')
       or d.device_uid is null
       or d.device_secret_encrypted is null then
      raise exception 'device cannot be rotated in its current lifecycle state';
    end if;
    next_uid := d.device_uid;
    next_status := 'provisioned';
    next_version := d.credential_version + 1;

    update public.devices
    set device_secret_encrypted = btrim(p_encrypted_secret),
        credential_version = next_version,
        lifecycle_status = next_status,
        is_active = false,
        last_nonce_ts = null,
        last_seen_at = null,
        updated_at = now()
    where id = d.id;

    insert into public.device_lifecycle_events (
      device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
      previous_name,new_name,credential_version,reason
    ) values (
      d.id,'credential_rotated',i.actor_user_id,d.warehouse_id,d.warehouse_id,
      d.name,d.name,next_version,coalesce(i.reason,'Device credentials rotated')
    );
  else
    if d.lifecycle_status not in ('provisioned','active','disabled')
       or d.device_uid is null
       or d.device_secret_encrypted is null
       or i.target_warehouse_id is null
       or i.target_warehouse_id = d.warehouse_id then
      raise exception 'device cannot be reassigned in its current lifecycle state';
    end if;
    next_uid := d.device_uid;
    next_status := 'reassignment_pending';
    next_version := d.credential_version + 1;

    update public.devices
    set warehouse_id = i.target_warehouse_id,
        device_secret_encrypted = btrim(p_encrypted_secret),
        credential_version = next_version,
        lifecycle_status = next_status,
        is_active = false,
        last_nonce_ts = null,
        last_seen_at = null,
        updated_at = now()
    where id = d.id;

    insert into public.device_lifecycle_events (
      device_id,event_type,actor_user_id,previous_warehouse_id,new_warehouse_id,
      previous_name,new_name,credential_version,reason
    ) values (
      d.id,'reassigned',i.actor_user_id,d.warehouse_id,i.target_warehouse_id,
      d.name,d.name,next_version,coalesce(i.reason,'Device reassigned and credentials rotated')
    );
  end if;

  update private.device_provisioning_intents
  set consumed_at = now()
  where id = i.id;

  return query
  select x.id,x.device_uid,x.warehouse_id,x.lifecycle_status,x.credential_version
  from public.devices x
  where x.id = d.id;
end;
$$;

revoke all on function public.consume_device_provisioning_intent(text,text)
  from public, anon, authenticated;
grant execute on function public.consume_device_provisioning_intent(text,text)
  to service_role;

create or replace function public.rename_device(p_device_id uuid, p_name text)
returns table(device_id uuid, device_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
  n text := btrim(coalesce(p_name,''));
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not exists (
    select 1
    from public.devices x
    join public.warehouses w on w.id = x.warehouse_id
    where x.id = p_device_id
      and (public.is_father_admin() or w.system_admin_id = auth.uid())
  ) then
    raise exception 'not authorized for this device';
  end if;
  if n = '' then
    raise exception 'device name cannot be blank';
  end if;

  select * into d from public.devices where id = p_device_id for update;
  if not found then raise exception 'device not found'; end if;
  if lower(btrim(d.name)) = lower(n) then
    return query select d.id,d.name;
    return;
  end if;

  update public.devices set name = n, updated_at = now() where id = p_device_id;

  insert into public.device_lifecycle_events (
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
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'trusted provisioning service required';
  end if;

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

-- Browser roles must never be able to update credential identity columns directly.
revoke update (device_uid, device_secret_encrypted) on public.devices
  from public, anon, authenticated;
