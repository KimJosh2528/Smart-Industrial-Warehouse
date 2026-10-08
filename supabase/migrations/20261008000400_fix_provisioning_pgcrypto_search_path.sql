-- Forward-only fix: qualify pgcrypto functions while SECURITY DEFINER functions
-- execute with an empty search_path.

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

  token := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash := encode(extensions.digest(convert_to(token, 'utf8'), 'sha256'), 'hex');
  secret_hash := encode(extensions.digest(convert_to(btrim(p_encrypted_secret), 'utf8'), 'sha256'), 'hex');

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

  token_hash := encode(extensions.digest(convert_to(p_intent_token, 'utf8'), 'sha256'), 'hex');
  secret_hash := encode(extensions.digest(convert_to(btrim(p_encrypted_secret), 'utf8'), 'sha256'), 'hex');

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

-- Read-only verification query (run manually after applying this migration):
-- select proname, pg_get_functiondef(oid) ilike '%extensions.digest%' as ok
-- from pg_proc where proname in ('create_device_provisioning_intent',
-- 'consume_device_provisioning_intent');
