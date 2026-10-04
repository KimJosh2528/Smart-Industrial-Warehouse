-- Store a server-encrypted copy of supported staff/truck RFID/PIN values.
-- The encryption key is never stored in PostgreSQL; access is server-side only.

create table public.access_credential_values (
  credential_id uuid primary key
    references public.access_credentials(id) on delete cascade,
  encrypted_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_credential_values_not_blank
    check (length(btrim(encrypted_value)) > 0)
);

alter table public.access_credential_values enable row level security;

revoke all on table public.access_credential_values from public, anon, authenticated;
