create table if not exists public.storefront_checkout_intents (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete restrict,
  token text not null unique,
  channel text not null default 'storefront' check (channel in ('storefront', 'whatsapp', 'telegram', 'api')),
  source_host text,
  status text not null default 'created' check (status in ('created', 'link_created', 'paid', 'cancelled', 'expired', 'failed')),
  customer_phone text,
  customer_name text,
  title_snapshot text not null,
  unit_price_amount numeric(12,2) not null,
  currency_code text not null default 'ARS',
  image_url_snapshot text,
  delivery_days_snapshot integer,
  galio_reference_id text unique,
  galio_payment_url text,
  galio_proof_token text,
  galio_payment_id text,
  galio_payment_status text,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists storefront_checkout_intents_order_id_idx
  on public.storefront_checkout_intents (order_id);

create index if not exists storefront_checkout_intents_product_id_idx
  on public.storefront_checkout_intents (product_id);

create index if not exists storefront_checkout_intents_status_idx
  on public.storefront_checkout_intents (status);

create index if not exists storefront_checkout_intents_created_at_idx
  on public.storefront_checkout_intents (created_at desc);

drop trigger if exists storefront_checkout_intents_set_updated_at on public.storefront_checkout_intents;
create trigger storefront_checkout_intents_set_updated_at
before update on public.storefront_checkout_intents
for each row
execute function public.set_current_timestamp_updated_at();
