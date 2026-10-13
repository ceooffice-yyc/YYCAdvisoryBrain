-- Run this in Supabase: Dashboard → SQL Editor → New query → paste → Run.  Safe to run again (it only adds what is missing).
-- The whole library is stored as key → JSON value in one table. Nothing is ever hard-deleted: every row has a status,
-- and every change records who made it.
create table if not exists public.kv (
  key        text primary key,
  value      jsonb not null,
  status     text not null default 'active' check (status in ('active', 'deleted')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deleted_by text
);

-- If you created the table with an earlier version of this file, these add what is new:
alter table public.kv add column if not exists status     text not null default 'active';
alter table public.kv add column if not exists deleted_at timestamptz;
alter table public.kv add column if not exists created_at timestamptz not null default now();
alter table public.kv add column if not exists updated_by text;
alter table public.kv add column if not exists deleted_by text;
do $$ begin
  alter table public.kv add constraint kv_status_check check (status in ('active', 'deleted'));
exception when duplicate_object then null; end $$;

create index if not exists kv_status_idx on public.kv (status);

-- Row Level Security ON with NO policies = the public (anon) key cannot read or write this table at all.
-- Only the server, using the service-role key, can. The browser talks to /api/kv, never to the table directly.
alter table public.kv enable row level security;

-- Restoring something that was deleted:
--   select key, deleted_at, deleted_by from public.kv where status = 'deleted' order by deleted_at desc;
--   update public.kv set status = 'active', deleted_at = null, deleted_by = null where key = 'kb:doc:THE-ID';
-- Records inside a list (lever records, the index) are soft-deleted too: they carry "status": "deleted" in their JSON.
-- Who changed a row last:  select key, updated_by, updated_at from public.kv order by updated_at desc limit 50;

-- Making someone an admin without touching server settings (alternative to the ADMIN_EMAILS setting):
--   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}' where email = 'name@yourcompany.com';
