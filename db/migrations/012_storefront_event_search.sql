alter table public.storefront_events
  drop constraint if exists storefront_events_event_name_check;

alter table public.storefront_events
  add constraint storefront_events_event_name_check
  check (event_name in ('page_view', 'search', 'view_content', 'contact', 'initiate_checkout', 'purchase'));

create index if not exists storefront_events_search_query_idx
  on public.storefront_events ((payload ->> 'search_query'), event_time desc)
  where event_name = 'search';
