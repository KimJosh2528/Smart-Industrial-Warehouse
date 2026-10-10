-- Replace the temporary demo RFID with the physical staff card.
-- The tag UID is intentionally not added; it remains unauthorized.
do $$
declare
  v_staff_id uuid;
  v_warehouse_id uuid;
  v_old_pool_id uuid;
  v_card_pool_id uuid;
  v_card_credential_id uuid;
  v_old_hash text := encode(digest('a1b2c3d4', 'sha256'), 'hex');
  v_card_hash text := encode(digest('b088c45c', 'sha256'), 'hex');
begin
  select s.id, s.warehouse_id
    into v_staff_id, v_warehouse_id
    from public.staff_members s
   where lower(s.display_name) = 'kent lore'
   limit 1;

  if v_staff_id is null then
    raise exception 'Kent Lore staff record was not found';
  end if;

  select r.id
    into v_old_pool_id
    from public.rfid_pool r
   where r.warehouse_id = v_warehouse_id
     and r.uid_hash = v_old_hash
   limit 1;

  if v_old_pool_id is not null then
    delete from public.member_application_rfid_assignments
     where rfid_pool_id = v_old_pool_id;
    delete from public.rfid_pool where id = v_old_pool_id;
  end if;

  delete from public.access_credentials
   where staff_member_id = v_staff_id
     and credential_type = 'staff_rfid'
     and credential_hash = v_old_hash;

  select r.id
    into v_card_pool_id
    from public.rfid_pool r
   where r.warehouse_id = v_warehouse_id
     and r.uid_hash = v_card_hash
   limit 1;

  if v_card_pool_id is null then
    insert into public.rfid_pool
      (warehouse_id, uid_label, uid_hash, status, credential_scope)
    values
      (v_warehouse_id, 'b088c45c', v_card_hash, 'assigned', 'staff')
    returning id into v_card_pool_id;
  else
    update public.rfid_pool
       set uid_label = 'b088c45c',
           status = 'assigned',
           credential_scope = 'staff',
           updated_at = now()
     where id = v_card_pool_id;
  end if;

  select c.id
    into v_card_credential_id
    from public.access_credentials c
   where c.credential_type = 'staff_rfid'
     and c.credential_hash = v_card_hash
   limit 1;

  if v_card_credential_id is null then
    insert into public.access_credentials
      (warehouse_id, staff_member_id, credential_type, credential_hash, is_active)
    values
      (v_warehouse_id, v_staff_id, 'staff_rfid', v_card_hash, true);
  else
    update public.access_credentials
       set warehouse_id = v_warehouse_id,
           staff_member_id = v_staff_id,
           truck_id = null,
           is_active = true,
           updated_at = now()
     where id = v_card_credential_id;
  end if;
end;
$$;
