-- Remove legacy vacant RFID pool entries that do not match supported UID sizes.
-- Valid UIDs are hexadecimal and exactly 8 or 14 characters.
delete from public.rfid_pool
 where status = 'vacant'
   and (
     uid_label !~* '^[0-9a-f]+$'
     or length(uid_label) not in (8, 14)
   );
