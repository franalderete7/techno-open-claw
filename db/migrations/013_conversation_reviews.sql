create table if not exists public.conversation_review_batches (
  id bigserial primary key,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  triggered_by text not null default 'cron',
  workflow_version text not null default 'v18',
  model_name text,
  repo_dir text,
  repo_commit_sha text,
  conversation_count integer not null default 0,
  conversation_ids jsonb not null default '[]'::jsonb,
  workflow_context jsonb not null default '{}'::jsonb,
  summary_markdown text,
  summary_json jsonb not null default '{}'::jsonb,
  overall_score integer,
  failure_message text,
  telegram_chat_ids jsonb not null default '[]'::jsonb,
  telegram_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists conversation_review_batches_created_at_idx
  on public.conversation_review_batches (created_at desc);

create index if not exists conversation_review_batches_status_idx
  on public.conversation_review_batches (status, created_at desc);

create table if not exists public.conversation_review_items (
  id bigserial primary key,
  batch_id bigint not null references public.conversation_review_batches(id) on delete cascade,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  score integer,
  verdict text,
  severity text,
  issue_types jsonb not null default '[]'::jsonb,
  root_cause_area text,
  what_went_wrong text,
  suggested_fix text,
  evidence jsonb not null default '[]'::jsonb,
  raw_analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, conversation_id)
);

create index if not exists conversation_review_items_batch_id_idx
  on public.conversation_review_items (batch_id);

create index if not exists conversation_review_items_conversation_id_idx
  on public.conversation_review_items (conversation_id);
