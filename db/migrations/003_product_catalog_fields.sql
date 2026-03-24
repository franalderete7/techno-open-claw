alter table public.products
  add column if not exists legacy_source_id bigint,
  add column if not exists category text,
  add column if not exists cost_usd numeric(12,2),
  add column if not exists logistics_usd numeric(12,2),
  add column if not exists total_cost_usd numeric(12,2),
  add column if not exists margin_pct numeric(10,4),
  add column if not exists price_usd numeric(12,2),
  add column if not exists promo_price_ars numeric(12,2),
  add column if not exists bancarizada_total numeric(12,2),
  add column if not exists bancarizada_cuota numeric(12,2),
  add column if not exists bancarizada_interest numeric(10,4),
  add column if not exists macro_total numeric(12,2),
  add column if not exists macro_cuota numeric(12,2),
  add column if not exists macro_interest numeric(10,4),
  add column if not exists cuotas_qty integer,
  add column if not exists in_stock boolean not null default false,
  add column if not exists delivery_type text,
  add column if not exists delivery_days integer,
  add column if not exists usd_rate numeric(12,2),
  add column if not exists image_url text,
  add column if not exists ram_gb integer,
  add column if not exists storage_gb integer,
  add column if not exists network text,
  add column if not exists color text,
  add column if not exists battery_health integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_battery_health_check'
  ) then
    alter table public.products
      add constraint products_battery_health_check
      check (battery_health is null or battery_health between 0 and 100);
  end if;
end $$;

create unique index if not exists products_legacy_source_id_idx
  on public.products (legacy_source_id)
  where legacy_source_id is not null;
