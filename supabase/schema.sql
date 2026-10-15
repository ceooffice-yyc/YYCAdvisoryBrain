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


-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Search index for "Ask the Brain": each document cut into ~800-character chunks, searchable by keyword (full-text) AND by meaning
-- (pgvector embeddings from Gemini gemini-embedding-001, 768 dimensions). Safe to run again.
-- This table is only an INDEX built from documents.full_text: the app rebuilds it whenever a document is saved, and
-- `npm run reindex` rebuilds all of it, so unlike the library tables its rows are replaced rather than soft-deleted.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
create extension if not exists vector;

create table if not exists public.doc_chunks (
  id              bigint generated always as identity primary key,
  doc_id          text not null references public.documents (id),
  pos             integer not null,                  -- order of the chunk inside its document
  heading         text not null default '',          -- the section heading the chunk sits under
  content         text not null,
  fts             tsvector generated always as (to_tsvector('english', coalesce(heading, '') || ' ' || content)) stored,
  embedding       vector(768),                       -- null until embedded (keyword search still works without it)
  embedding_model text,
  updated_at      timestamptz not null default now(),
  unique (doc_id, pos)
);
create index if not exists doc_chunks_fts_idx on public.doc_chunks using gin (fts);
create index if not exists doc_chunks_emb_idx on public.doc_chunks using hnsw (embedding vector_cosine_ops);
alter table public.doc_chunks enable row level security;   -- no policies: only the server (service-role key) can read or write

-- Hybrid search: keyword rank + meaning rank, merged with reciprocal rank fusion (k = 60). At most per_doc chunks per document.
--   query_text       a websearch_to_tsquery string, the server joins the words with "or"
--   query_embedding  the question's vector, or null for keyword-only search
create or replace function public.search_chunks(
  query_text text,
  query_embedding vector(768),
  match_count integer default 12,
  per_doc integer default 3
)
returns table (doc_id text, pos integer, heading text, content text, score double precision, kw_rank integer, vec_rank integer)
language sql stable
as $$
  with q as (select websearch_to_tsquery('english', coalesce(query_text, '')) as tsq),
  kw as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc, c.id) as r
    from public.doc_chunks c cross join q
    where c.fts @@ q.tsq
    order by ts_rank_cd(c.fts, q.tsq) desc, c.id
    limit 40
  ),
  vec as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding, c.id) as r
    from public.doc_chunks c
    where query_embedding is not null and c.embedding is not null
    order by c.embedding <=> query_embedding, c.id
    limit 40
  ),
  fused as (
    select coalesce(kw.id, vec.id) as id,
           coalesce(1.0 / (60 + kw.r), 0) + coalesce(1.0 / (60 + vec.r), 0) as score,
           kw.r as kw_rank, vec.r as vec_rank
    from kw full outer join vec on kw.id = vec.id
  ),
  ranked as (
    select c.doc_id, c.pos, c.heading, c.content, f.score, f.kw_rank, f.vec_rank,
           row_number() over (partition by c.doc_id order by f.score desc, c.pos) as doc_rn
    from fused f
    join public.doc_chunks c on c.id = f.id
    join public.documents d on d.id = c.doc_id and d.status = 'active'
  )
  select r.doc_id, r.pos, r.heading, r.content, r.score::double precision, r.kw_rank::integer, r.vec_rank::integer
  from ranked r
  where r.doc_rn <= per_doc
  order by r.score desc, r.doc_id, r.pos
  limit match_count;
$$;
revoke execute on function public.search_chunks(text, vector, integer, integer) from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Ask the Brain log: one row per question, written by the server. It is how you find out what is not working: refused questions,
-- thumbs-down answers, answers whose figures could not be matched to the sources, slow answers. Safe to run again.
-- It holds the questions and answers people see, so treat it like the chats table. Set ASK_LOG=off on the server to stop writing it,
-- and delete old rows whenever you like:  delete from public.ask_log where created_at < now() - interval '180 days';
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.ask_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  user_email    text,
  question      text not null,
  standalone    text,                                  -- the question as rewritten to stand alone (follow-ups)
  intent        text,                                  -- 'list' | 'question'
  keywords      jsonb not null default '[]'::jsonb,    -- the search words the AI added
  mode          text,                                  -- 'hybrid' | 'keyword' | 'browser' (how the search ran)
  answerable    boolean,
  answer        text,
  citations     jsonb,
  retrieved     jsonb,                                 -- the documents the search found, with scores
  unsupported   jsonb not null default '[]'::jsonb,    -- figures in the answer that appear nowhere in the sources
  trace         jsonb,                                 -- chunk / record ids shown to the AI, prompt size, timings
  ms            integer,                               -- total time
  error         text,                                  -- set when the question failed (no answer was produced)
  feedback      smallint check (feedback in (-1, 1)),  -- thumbs down / up from the person
  feedback_note text,
  feedback_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists ask_log_created_idx on public.ask_log (created_at desc);
create index if not exists ask_log_user_idx    on public.ask_log (user_id);
alter table public.ask_log enable row level security;   -- no policies: only the server (service-role key) can read or write

-- Useful questions to ask of it (Dashboard → SQL Editor):
--   select created_at, question from public.ask_log where answerable = false order by created_at desc limit 50;                -- refused
--   select created_at, question, feedback_note from public.ask_log where feedback = -1 order by created_at desc limit 50;       -- thumbs down
--   select created_at, question, unsupported from public.ask_log where unsupported <> '[]'::jsonb order by created_at desc;    -- unmatched figures
--   select percentile_cont(0.5) within group (order by ms) as p50, percentile_cont(0.95) within group (order by ms) as p95 from public.ask_log;
