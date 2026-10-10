-- Expose the approved application contact details on staff, guard, and driver records.
-- Existing records are matched to their approved application by warehouse, role, and name.

create or replace function public.list_staff_record_application_contact(p_staff_member_id uuid)
returns table(applicant_email text, facebook_profile_url text)
language sql
stable
security definer
set search_path = public
as $$
  select a.applicant_email, a.facebook_profile_url
    from public.staff_members s
    join public.warehouse_member_applications a
      on a.warehouse_id = s.warehouse_id
     and a.applicant_name = s.display_name
     and a.requested_role = s.member_type
     and a.status = 'approved'
   where s.id = p_staff_member_id
     and public.is_warehouse_owner(s.warehouse_id)
   order by a.updated_at desc
   limit 1;
$$;

create or replace function public.list_driver_record_application_contact(p_driver_id uuid)
returns table(applicant_email text, facebook_profile_url text)
language sql
stable
security definer
set search_path = public
as $$
  select a.applicant_email, a.facebook_profile_url
    from public.drivers d
    join public.warehouse_member_applications a
      on a.warehouse_id = d.warehouse_id
     and a.applicant_name = d.display_name
     and a.requested_role = 'driver'
     and a.status = 'approved'
   where d.id = p_driver_id
     and public.is_warehouse_owner(d.warehouse_id)
   order by a.updated_at desc
   limit 1;
$$;

revoke all on function public.list_staff_record_application_contact(uuid) from public, anon;
grant execute on function public.list_staff_record_application_contact(uuid) to authenticated;
revoke all on function public.list_driver_record_application_contact(uuid) from public, anon;
grant execute on function public.list_driver_record_application_contact(uuid) to authenticated;
