create table if not exists public.operator_confirmations (
  id bigserial primary key,
  token text not null unique,
  channel text not null,
  actor_ref text not null,
  chat_id text not null,
  command text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'executed', 'expired')),
  expires_at timestamptz not null,
  executed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operator_confirmations_actor_status_idx
  on public.operator_confirmations (actor_ref, status, created_at desc);

create index if not exists operator_confirmations_chat_status_idx
  on public.operator_confirmations (chat_id, status, created_at desc);

drop trigger if exists operator_confirmations_set_updated_at on public.operator_confirmations;
create trigger operator_confirmations_set_updated_at
before update on public.operator_confirmations
for each row
execute function public.set_current_timestamp_updated_at();
