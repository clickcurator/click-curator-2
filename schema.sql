-- Click Curator 2.0 schema
-- Run this on a Supabase (or any Postgres 15+) instance with pgvector enabled.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- One row per unique piece of content in the archive
create table if not exists articles (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  url           text not null,
  category      text not null,
  date_sent     date not null,
  source_domain text,                      -- e.g. "x.com", "christianpost.com", "youtube.com"
  thumbnail_url text,                       -- scraped from og:image
  summary       text,                       -- AI-generated 1-2 sentence summary
  raw_text      text,                       -- extracted post/article text, for X posts especially
  engagement_score  numeric,                -- 0-100, from oEmbed metrics when available
  ai_score          numeric,                -- 0-100, AI-estimated engagement potential fallback
  final_score       numeric generated always as (coalesce(engagement_score, ai_score)) stored,
  embedding     vector(1536),               -- for semantic/topic search
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_articles_category on articles (category);
create index if not exists idx_articles_date_sent on articles (date_sent desc);
create index if not exists idx_articles_final_score on articles (final_score desc);
-- Vector similarity index (requires pgvector >= 0.5)
create index if not exists idx_articles_embedding on articles
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Full text search fallback for keyword queries
alter table articles add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,''))) stored;
create index if not exists idx_articles_search_vector on articles using gin (search_vector);

-- One row per subscriber (creator)
create table if not exists creators (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  name        text,
  created_at  timestamptz not null default now()
);

-- Per-creator "used" tracking -- same article can be marked used by many creators independently
create table if not exists article_usage (
  creator_id  uuid not null references creators(id) on delete cascade,
  article_id  uuid not null references articles(id) on delete cascade,
  used_at     timestamptz not null default now(),
  primary key (creator_id, article_id)
);

create index if not exists idx_article_usage_creator on article_usage (creator_id);
