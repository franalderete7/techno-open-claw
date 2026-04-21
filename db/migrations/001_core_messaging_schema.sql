-- Core schema for TechnoStore API (customers, conversations, messages, settings).
-- Safe on existing databases: uses IF NOT EXISTS / IF NOT EXISTS constraints.

create table if not exists public.customers (
  id bigserial primary key,
  external_ref text unique,
  first_name text,
  last_name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_phone_idx on public.customers (phone) where phone is not null;

create table if not exists public.conversations (
  id bigserial primary key,
  customer_id bigint references public.customers (id) on delete set null,
  channel text not null,
  channel_thread_key text not null,
  status text not null default 'open',
  title text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Required for conversation upserts (ON CONFLICT). IF NOT EXISTS is safe if a prior migration already added uniqueness.
create unique index if not exists conversations_channel_thread_key_ux on public.conversations (channel_thread_key);

create table if not exists public.messages (
  id bigserial primary key,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  direction text not null,
  sender_kind text not null,
  message_type text not null,
  text_body text,
  media_url text,
  transcript text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now()
);
