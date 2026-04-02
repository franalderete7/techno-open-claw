create table if not exists public.storefront_events (
  id bigserial primary key,
  event_name text not null check (event_name in ('page_view', 'view_content', 'contact', 'initiate_checkout', 'purchase')),
  event_key text unique,
  received_from text not null default 'browser' check (received_from in ('browser', 'server')),
  visitor_id text,
  session_id text,
  source_host text,
  page_url text,
  page_path text,
  referrer text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  product_id bigint references public.products(id) on delete set null,
  order_id bigint references public.orders(id) on delete set null,
  customer_id bigint references public.customers(id) on delete set null,
  checkout_intent_id bigint references public.storefront_checkout_intents(id) on delete set null,
  currency_code text,
  value_amount numeric(12,2),
  payload jsonb not null default '{}'::jsonb,
  event_time timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists storefront_events_event_time_idx
  on public.storefront_events (event_time desc);

create index if not exists storefront_events_event_name_idx
  on public.storefront_events (event_name, event_time desc);

create index if not exists storefront_events_visitor_id_idx
  on public.storefront_events (visitor_id, event_time desc);

create index if not exists storefront_events_session_id_idx
  on public.storefront_events (session_id, event_time desc);

create index if not exists storefront_events_product_id_idx
  on public.storefront_events (product_id, event_time desc);

create index if not exists storefront_events_order_id_idx
  on public.storefront_events (order_id, event_time desc);

create index if not exists storefront_events_page_path_idx
  on public.storefront_events (page_path, event_time desc);
