alter table public.storefront_checkout_intents
  add column if not exists payment_provider text,
  add column if not exists payment_reference_id text,
  add column if not exists payment_url text,
  add column if not exists payment_id text,
  add column if not exists payment_status text;

update public.storefront_checkout_intents
set
  payment_provider = coalesce(payment_provider, 'galiopay'),
  payment_reference_id = coalesce(payment_reference_id, galio_reference_id),
  payment_url = coalesce(payment_url, galio_payment_url),
  payment_id = coalesce(payment_id, galio_payment_id),
  payment_status = coalesce(payment_status, galio_payment_status)
where payment_provider is null
   or payment_reference_id is null
   or payment_url is null
   or payment_id is null
   or payment_status is null;

alter table public.storefront_checkout_intents
  alter column payment_provider set default 'galiopay';

update public.storefront_checkout_intents
set payment_provider = 'galiopay'
where payment_provider is null;

alter table public.storefront_checkout_intents
  alter column payment_provider set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'storefront_checkout_intents_payment_provider_check'
  ) then
    alter table public.storefront_checkout_intents
      add constraint storefront_checkout_intents_payment_provider_check
      check (payment_provider in ('galiopay', 'talo'));
  end if;
end $$;

create unique index if not exists storefront_checkout_intents_payment_reference_id_uidx
  on public.storefront_checkout_intents (payment_reference_id)
  where payment_reference_id is not null;
