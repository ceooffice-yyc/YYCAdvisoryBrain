-- Run this in Supabase: Dashboard → SQL Editor → New query → paste → Run.  Safe to run again (it only adds what is missing).
--
-- The library lives in real tables (not one JSON blob):
--   documents   one row per case study
--   records     one row per extracted strategy (the lever records), pointing at its document
--   levers      the lever definitions the extraction prompt is built from: custom levers, edits to the built-in levers,
--               and the "Others" sub-categories (built-in edits + custom ones)
--   gap_log     questions the library could not answer
--   chats       one chat history per signed-in person
--   suggestions the cached example questions shown in Ask the Brain
-- Nothing is ever hard-deleted: every row has a status ('active' | 'deleted'), deleted_at, and who created / changed / deleted it.
-- Row Level Security is ON with NO policies, so the public (anon) key cannot read or write anything: only the server (service-role key) can.

create table if not exists public.documents (
  id                text primary key,
  title             text not null default '',
  doc_type          text,
  industry          text,
  industry_main     text,
  industry_sub      text,
  language          text,
  problem_signature text,
  sections          jsonb not null default '[]'::jsonb,
  full_text         text not null default '',
  html              text not null default '',
  created           bigint,                       -- milliseconds since 1970, as the app stores it
  status            text not null default 'active' check (status in ('active', 'deleted')),
  created_by        text,
  updated_by        text,
  deleted_by        text,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.records (
  id             text primary key,
  doc_id         text not null references public.documents (id),
  doc_title      text,
  lever          text not null,                   -- a built-in lever id or a custom lever id (see levers)
  other_category text,                            -- only for lever = 'others'
  related_to     text,
  claim_en       text,
  claim_zh       text,
  quote          text,
  impact         text,
  section        text,
  extra          jsonb not null default '{}'::jsonb, -- any other fields of the record, kept as they were
  position       integer not null default 0,       -- order inside its document
  status         text not null default 'active' check (status in ('active', 'deleted')),
  created_by     text,
  updated_by     text,
  deleted_by     text,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists records_doc_idx   on public.records (doc_id);
create index if not exists records_lever_idx on public.records (lever) where status = 'active';

create table if not exists public.levers (
  id         text primary key,                    -- built-in lever id (e.g. price), custom id, or sub-category id
  kind       text not null check (kind in ('custom', 'builtin_override', 'sub_override', 'sub_custom')),
  name       text,
  definition text,                                -- what the AI is told this lever / sub-category means
  example    text,
  headings   text,                                -- extra document-heading words that map to this lever (comma separated)
  sort_order integer not null default 0,
  status     text not null default 'active' check (status in ('active', 'deleted')),
  created_by text,
  updated_by text,
  deleted_by text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gap_log (
  id         text primary key,
  question   text not null,
  at         bigint,
  status     text not null default 'active' check (status in ('active', 'deleted')),
  created_by text,
  deleted_by text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.chats (
  user_id    uuid primary key,                    -- the Supabase Auth user
  messages   jsonb not null default '[]'::jsonb,  -- each message carries its own status (Clear chat marks them deleted)
  updated_at timestamptz not null default now()
);

create table if not exists public.suggestions (
  id         text primary key default 'current',
  value      jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.documents   enable row level security;
alter table public.records     enable row level security;
alter table public.levers      enable row level security;
alter table public.gap_log     enable row level security;
alter table public.chats       enable row level security;
alter table public.suggestions enable row level security;

-- The old single key/value table (public.kv) from earlier versions is no longer used. It is left untouched so nothing is lost;
-- move its data across with the app's Export backup (old version) → Import backup (this version), then drop it if you like.

-- Restoring something that was deleted (Dashboard → SQL Editor):
--   select id, title, deleted_at, deleted_by from public.documents where status = 'deleted' order by deleted_at desc;
--   update public.documents set status = 'active', deleted_at = null, deleted_by = null where id = 'THE-ID';
--   update public.records   set status = 'active', deleted_at = null, deleted_by = null where doc_id = 'THE-ID';   -- its strategies
-- Who changed what last:  select id, title, updated_by, updated_at from public.documents order by updated_at desc limit 50;

-- Making someone an admin without touching server settings (alternative to the ADMIN_EMAILS setting):
--   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}' where email = 'name@yourcompany.com';
