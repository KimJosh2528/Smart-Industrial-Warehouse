-- Compatibility RPC for PostgREST schema caches that registered the claim
-- parameters as driver first, staff second.

create or replace function public.create_account_claim_request_v2(
  p_driver_id uuid default null,
  p_staff_member_id uuid default null
)
returns table(request_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_warehouse_id uuid;
  target_profile_id uuid;
  generated_token text;
  generated_expires_at timestamptz;
  created_request_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if (p_staff_member_id is null) = (p_driver_id is null) then raise exception 'claim_target_required'; end if;

  if p_staff_member_id is not null then
    select s.warehouse_id, s.profile_id into target_warehouse_id, target_profile_id
      from public.staff_members s where s.id = p_staff_member_id for update;
    if target_warehouse_id is null then raise exception 'staff_member_not_found'; end if;
    if target_profile_id is not null then raise exception 'staff_already_claimed'; end if;
  else
    select d.warehouse_id, d.profile_id into target_warehouse_id, target_profile_id
      from public.drivers d where d.id = p_driver_id for update;
    if target_warehouse_id is null then raise exception 'driver_not_found'; end if;
    if target_profile_id is not null then raise exception 'driver_already_claimed'; end if;
  end if;

  if not public.is_warehouse_owner(target_warehouse_id) then raise exception 'warehouse_not_owned'; end if;

  update public.account_claim_requests set revoked_at = now()
   where ((p_staff_member_id is not null and staff_member_id = p_staff_member_id)
       or (p_driver_id is not null and driver_id = p_driver_id))
     and used_at is null and revoked_at is null;

  generated_token := encode(gen_random_bytes(32), 'hex');
  generated_expires_at := now() + interval '24 hours';
  insert into public.account_claim_requests (warehouse_id, staff_member_id, driver_id, token_hash, expires_at, created_by)
  values (target_warehouse_id, p_staff_member_id, p_driver_id, encode(digest(generated_token, 'sha256'), 'hex'), generated_expires_at, auth.uid())
  returning id into created_request_id;
  return query select created_request_id, generated_token, generated_expires_at;
end;
$$;

revoke all on function public.create_account_claim_request_v2(uuid, uuid) from public, anon;
grant execute on function public.create_account_claim_request_v2(uuid, uuid) to authenticated;
