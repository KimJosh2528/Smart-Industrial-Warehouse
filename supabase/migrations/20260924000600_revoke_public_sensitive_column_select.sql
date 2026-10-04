-- Remove inherited PUBLIC read access to sensitive columns.
-- Explicit service_role grants remain available for server-side workflows.

revoke select (credential_hash) on public.access_credentials from public;
revoke select (device_secret_encrypted) on public.devices from public;
