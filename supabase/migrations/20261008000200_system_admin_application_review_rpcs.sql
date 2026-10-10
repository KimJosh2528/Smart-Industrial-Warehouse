-- Additive Father Admin review RPCs for the existing System Admin
-- application and one-time account-claim architecture.
-- This migration intentionally does not alter tables, policies, triggers,
-- submit_system_admin_application(), get_account_claim(), or claim_account().

do $$
declare
  claim_check text;
  get_claim_definition text;
  claim_account_definition text;
begin
  if to_regclass('public.system_admin_applications') is null then
    raise exception 'system_admin_applications_table_required';
  end if;
  if to_regclass('public.account_claim_requests') is null then
    raise exception 'account_claim_requests_table_required';
  end if;
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'account_claim_requests'
       and column_name = 'system_admin_application_id'
  ) then
    raise exception 'system_admin_claim_column_required';
  end if;
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.account_claim_requests'::regclass
       and c.contype = 'f'
       and pg_get_constraintdef(c.oid) like '%system_admin_application_id%'
       and pg_get_constraintdef(c.oid) like '%system_admin_applications%'
  ) then
    raise exception 'system_admin_claim_foreign_key_required';
  end if;
  select pg_get_constraintdef(c.oid)
    into claim_check
    from pg_constraint c
   where c.conrelid = 'public.account_claim_requests'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%system_admin_application_id%'
   limit 1;
  if claim_check is null then
    raise exception 'system_admin_claim_target_constraint_required';
  end if;
  if to_regprocedure('public.is_father_admin()') is null then
    raise exception 'is_father_admin_function_required';
  end if;
  if to_regprocedure('public.get_account_claim(text)') is null then
    raise exception 'get_account_claim_function_required';
  end if;
  if to_regprocedure('public.claim_account(text)') is null then
    raise exception 'claim_account_function_required';
  end if;
  select pg_get_functiondef('public.get_account_claim(text)'::regprocedure)
    into get_claim_definition;
  select pg_get_functiondef('public.claim_account(text)'::regprocedure)
    into claim_account_definition;
  if position('system_admin_application_id' in get_claim_definition) = 0
     or position('system_admin_application_id' in claim_account_definition) = 0 then
    raise exception 'system_admin_claim_flow_support_required';
  end if;
end;
$$;

create function public.list_system_admin_applications()
returns table(
  id uuid,
  applicant_name text,
  applicant_email text,
  valid_id_url text,
  facebook_profile_url text,
  requested_warehouse_name text,
  status text,
  rejection_reason text,
  warehouse_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.id,
         a.applicant_name,
         a.applicant_email,
         a.valid_id_url,
         a.facebook_profile_url,
         a.requested_warehouse_name,
         a.status,
         a.rejection_reason,
         a.warehouse_id,
         a.created_at
    from public.system_admin_applications a
   where public.is_father_admin()
   order by a.created_at desc;
$$;

create function public.approve_system_admin_application(
  p_application_id uuid,
  p_warehouse_name text default null
)
returns table(warehouse_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  application_row public.system_admin_applications;
  created_warehouse_id uuid;
  generated_token text;
  generated_expires_at timestamptz;
  final_warehouse_name text;
begin
  if auth.uid() is null or not public.is_father_admin() then
    raise exception 'only_father_admin_may_approve';
  end if;

  if p_application_id is null then
    raise exception 'system_admin_application_id_required';
  end if;
  if p_warehouse_name is not null
     and length(btrim(p_warehouse_name)) < 2 then
    raise exception 'warehouse_name_invalid';
  end if;

  select *
    into application_row
    from public.system_admin_applications
   where id = p_application_id
   for update;

  if application_row.id is null then
    raise exception 'system_admin_application_not_found';
  end if;
  if application_row.status <> 'pending' then
    raise exception 'system_admin_application_not_pending';
  end if;

  final_warehouse_name := coalesce(
    nullif(btrim(p_warehouse_name), ''),
    btrim(application_row.requested_warehouse_name)
  );
  if length(final_warehouse_name) < 2 then
    raise exception 'warehouse_name_invalid';
  end if;

  insert into public.warehouses (owner_id, name, system_admin_id)
  values (auth.uid(), final_warehouse_name, null)
  returning id into created_warehouse_id;

  generated_token := encode(gen_random_bytes(32), 'hex');
  generated_expires_at := now() + interval '24 hours';

  insert into public.account_claim_requests (
    warehouse_id,
    system_admin_application_id,
    token_hash,
    expires_at,
    created_by
  )
  values (
    created_warehouse_id,
    application_row.id,
    encode(digest(generated_token, 'sha256'), 'hex'),
    generated_expires_at,
    auth.uid()
  );

  update public.system_admin_applications
     set status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         warehouse_id = created_warehouse_id,
         updated_at = now()
   where id = application_row.id;

  return query
    select created_warehouse_id, generated_token, generated_expires_at;
end;
$$;

create function public.reject_system_admin_application(
  p_application_id uuid,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_father_admin() then
    raise exception 'only_father_admin_may_reject';
  end if;
  if p_application_id is null then
    raise exception 'system_admin_application_id_required';
  end if;
  if p_rejection_reason is not null
     and length(p_rejection_reason) > 500 then
    raise exception 'rejection_reason_too_long';
  end if;

  update public.system_admin_applications
     set status = 'rejected',
         rejection_reason = nullif(btrim(p_rejection_reason), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at = now()
   where id = p_application_id
     and status = 'pending';

  if not found then
    raise exception 'system_admin_application_not_pending';
  end if;
end;
$$;

revoke all on function public.list_system_admin_applications() from public, anon;
revoke all on function public.approve_system_admin_application(uuid, text) from public, anon;
revoke all on function public.reject_system_admin_application(uuid, text) from public, anon;

grant execute on function public.list_system_admin_applications() to authenticated;
grant execute on function public.approve_system_admin_application(uuid, text) to authenticated;
grant execute on function public.reject_system_admin_application(uuid, text) to authenticated;
