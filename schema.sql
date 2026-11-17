-- Krishi Saathi — database schema for Supabase (PostgreSQL)
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Only the backend server talks to these tables (using the service-role key).
-- Row Level Security is switched ON with no policies, so the public "anon" key
-- cannot read or write anything directly.

create extension if not exists pgcrypto;

-- One row per device / app install (farmers don't need to log in).
create table if not exists farmers (
  id          uuid primary key default gen_random_uuid(),
  device_id   text unique not null,
  region      text,
  crops       text,
  land        text,
  stage       text,
  language    text default 'auto',
  channel     text default 'web',          -- web | app | whatsapp (later)
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  farmer_id   uuid not null references farmers(id) on delete cascade,
  title       text,
  language    text,
  channel     text default 'web',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conversations_farmer_idx on conversations (farmer_id, updated_at desc);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  lang            text,                     -- reply language code (assistant rows)
  image_count     int  not null default 0,
  question        text,                     -- the farmer question this answer replies to (assistant rows)
  topic           text,                     -- short English topic label (assistant rows)
  kb_gap          boolean not null default false, -- true when the knowledge base didn't cover it
  suggestions     jsonb,
  rating          smallint check (rating in (-1, 1)),
  model           text,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages (conversation_id, created_at);
create index if not exists messages_gap_idx on messages (kb_gap, created_at desc) where kb_gap;

-- The knowledge base the bot answers from.
create table if not exists kb_entries (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'Other',
  content     text not null,
  keywords    text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Lock everything down: only the service-role key (used by the backend) can access.
alter table farmers       enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table kb_entries    enable row level security;

-- Insight views (security_invoker keeps RLS in force for anyone but the backend).
create or replace view insights_languages with (security_invoker = true) as
  select coalesce(nullif(lang, ''), '?') as lang, count(*)::int as n
  from messages where role = 'assistant'
  group by 1 order by 2 desc;

create or replace view insights_topics with (security_invoker = true) as
  select lower(topic) as topic, count(*)::int as n
  from messages where role = 'assistant' and coalesce(topic, '') <> ''
  group by 1 order by 2 desc limit 25;

create or replace view insights_totals with (security_invoker = true) as
  select
    (select count(*) from messages where role = 'assistant')::int            as answers,
    (select count(*) from farmers)::int                                       as farmers,
    (select count(*) from messages where kb_gap)::int                         as gaps,
    (select count(*) from messages where rating = 1)::int                     as thumbs_up,
    (select count(*) from messages where rating = -1)::int                    as thumbs_down,
    (select count(*) from kb_entries where active)::int                       as kb_entries;
