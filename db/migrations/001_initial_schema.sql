create extension if not exists pgcrypto;

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

create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_email_idx on public.customers (email);
create index if not exists customers_updated_at_idx on public.customers (updated_at desc);

create table if not exists public.conversations (
  id bigserial primary key,
  customer_id bigint references public.customers(id) on delete set null,
  channel text not null,
  channel_thread_key text not null unique,
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create index if not exists conversations_customer_id_idx on public.conversations (customer_id);
create index if not exists conversations_channel_idx on public.conversations (channel);
create index if not exists conversations_last_message_at_idx on public.conversations (last_message_at desc);

create table if not exists public.messages (
  id bigserial primary key,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound', 'system')),
  sender_kind text not null check (sender_kind in ('customer', 'agent', 'admin', 'tool', 'system')),
  message_type text not null check (message_type in ('text', 'audio', 'image', 'video', 'file', 'event')),
  text_body text,
  media_url text,
  transcript text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on public.messages (conversation_id, created_at asc);
create index if not exists messages_created_at_idx on public.messages (created_at desc);

create table if not exists public.products (
  id bigserial primary key,
  sku text not null unique,
  slug text not null unique,
  brand text not null,
  model text not null,
  title text not null,
  description text,
  condition text not null default 'new' check (condition in ('new', 'used', 'like_new', 'refurbished')),
  price_amount numeric(12,2),
  currency_code text not null default 'ARS',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_brand_model_idx on public.products (brand, model);
create index if not exists products_active_idx on public.products (active);
create index if not exists products_updated_at_idx on public.products (updated_at desc);

create table if not exists public.stock_units (
  id bigserial primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  serial_number text unique,
  color text,
  battery_health integer check (battery_health between 0 and 100),
  status text not null default 'in_stock' check (status in ('in_stock', 'reserved', 'sold', 'damaged')),
  location_code text,
  cost_amount numeric(12,2),
  currency_code text not null default 'ARS',
  acquired_at timestamptz,
  sold_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_units_product_id_idx on public.stock_units (product_id);
create index if not exists stock_units_status_idx on public.stock_units (status);
create index if not exists stock_units_updated_at_idx on public.stock_units (updated_at desc);

create table if not exists public.orders (
  id bigserial primary key,
  order_number text not null unique default concat('TOC-', upper(substr(gen_random_uuid()::text, 1, 8))),
  customer_id bigint references public.customers(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'telegram', 'whatsapp', 'web', 'api')),
  status text not null default 'draft' check (status in ('draft', 'pending', 'paid', 'cancelled', 'fulfilled')),
  currency_code text not null default 'ARS',
  subtotal_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

create table if not exists public.order_items (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint references public.products(id) on delete set null,
  stock_unit_id bigint references public.stock_units(id) on delete set null,
  title_snapshot text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_amount numeric(12,2) not null,
  currency_code text not null default 'ARS',
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_type text not null check (actor_type in ('system', 'agent', 'admin', 'customer', 'tool')),
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

insert into public.settings (key, value)
values
  ('store', jsonb_build_object(
    'name', 'TechnoStore',
    'storefront_url', 'https://puntotechno.com',
    'ops_host', 'https://aldegol.com'
  ))
on conflict (key) do nothing;
