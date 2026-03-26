create table if not exists public.inventory_purchases (
  id bigserial primary key,
  purchase_number text not null unique default concat('PUR-', upper(substr(gen_random_uuid()::text, 1, 8))),
  supplier_name text,
  currency_code text not null default 'USD',
  total_amount numeric(12,2),
  status text not null default 'draft' check (status in ('draft', 'received', 'cancelled')),
  acquired_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_purchases_status_idx on public.inventory_purchases (status);
create index if not exists inventory_purchases_acquired_at_idx on public.inventory_purchases (acquired_at desc nulls last);
create index if not exists inventory_purchases_created_at_idx on public.inventory_purchases (created_at desc);

create table if not exists public.inventory_purchase_funders (
  id bigserial primary key,
  inventory_purchase_id bigint not null references public.inventory_purchases(id) on delete cascade,
  funder_name text not null,
  payment_method text,
  amount_amount numeric(12,2),
  currency_code text not null default 'USD',
  share_pct numeric(10,4),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_purchase_funders_purchase_idx
  on public.inventory_purchase_funders (inventory_purchase_id, created_at asc);

alter table public.stock_units
  add column if not exists inventory_purchase_id bigint;

alter table public.stock_units
  drop constraint if exists stock_units_inventory_purchase_id_fkey;

alter table public.stock_units
  add constraint stock_units_inventory_purchase_id_fkey
  foreign key (inventory_purchase_id) references public.inventory_purchases(id) on delete restrict;

alter table public.stock_units
  alter column inventory_purchase_id set not null;

create index if not exists stock_units_inventory_purchase_id_idx
  on public.stock_units (inventory_purchase_id);

drop trigger if exists inventory_purchases_set_updated_at on public.inventory_purchases;
create trigger inventory_purchases_set_updated_at
before update on public.inventory_purchases
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists inventory_purchase_funders_set_updated_at on public.inventory_purchase_funders;
create trigger inventory_purchase_funders_set_updated_at
before update on public.inventory_purchase_funders
for each row
execute function public.set_current_timestamp_updated_at();
