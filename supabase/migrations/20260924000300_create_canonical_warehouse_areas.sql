-- Complete the canonical warehouse topology using the existing area-type catalog.
-- Idempotent by the existing (warehouse_id, area_type_code) uniqueness constraint.

insert into public.warehouse_areas (warehouse_id, area_type_code, state)
values
  ('8e2693ee-96a0-4d5a-b3a7-e5687eb6b245', 'staff_entrance', 'locked'),
  ('8e2693ee-96a0-4d5a-b3a7-e5687eb6b245', 'staff_room_1', 'locked'),
  ('8e2693ee-96a0-4d5a-b3a7-e5687eb6b245', 'staff_room_2', 'locked'),
  ('8e2693ee-96a0-4d5a-b3a7-e5687eb6b245', 'staff_room_3', 'locked'),
  ('8e2693ee-96a0-4d5a-b3a7-e5687eb6b245', 'staff_room_4', 'locked')
on conflict (warehouse_id, area_type_code) do nothing;
