alter table public.stock_units
  add column if not exists imei_1 text,
  add column if not exists imei_2 text;

create index if not exists stock_units_imei_1_idx on public.stock_units (imei_1) where imei_1 is not null;
create index if not exists stock_units_imei_2_idx on public.stock_units (imei_2) where imei_2 is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_units_distinct_imeis_check'
  ) then
    alter table public.stock_units
      add constraint stock_units_distinct_imeis_check
      check (imei_1 is null or imei_2 is null or imei_1 <> imei_2);
  end if;
end $$;

create or replace function public.enforce_stock_unit_imeis()
returns trigger
language plpgsql
as $$
begin
  if new.imei_1 is not null and exists (
    select 1
    from public.stock_units su
    where su.id <> coalesce(new.id, 0)
      and (su.imei_1 = new.imei_1 or su.imei_2 = new.imei_1)
  ) then
    raise exception 'IMEI already exists in another stock unit: %', new.imei_1;
  end if;

  if new.imei_2 is not null and exists (
    select 1
    from public.stock_units su
    where su.id <> coalesce(new.id, 0)
      and (su.imei_1 = new.imei_2 or su.imei_2 = new.imei_2)
  ) then
    raise exception 'IMEI already exists in another stock unit: %', new.imei_2;
  end if;

  return new;
end;
$$;

drop trigger if exists stock_units_enforce_imeis on public.stock_units;
create trigger stock_units_enforce_imeis
before insert or update of imei_1, imei_2 on public.stock_units
for each row
execute function public.enforce_stock_unit_imeis();
